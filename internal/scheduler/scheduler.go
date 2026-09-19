// Package scheduler implements a timer-based reminder engine.
// It calculates the next scheduled event and fires at exactly the right time,
// avoiding any per-second polling. When the schedule changes, the timer is
// cancelled and recalculated.
package scheduler

import (
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"time-check/internal/attendance"
	"time-check/internal/notification"
	"time-check/internal/schedule"
	"time-check/internal/storage"
)

// Clock is an injectable time source.
type Clock interface {
	Now() time.Time
}

// RealClock uses the system clock.
type RealClock struct{}

func (RealClock) Now() time.Time { return time.Now() }

// Timer is an injectable timer factory for testing.
type Timer interface {
	AfterFunc(d time.Duration, f func()) TimerHandle
}

// TimerHandle represents a cancelable timer.
type TimerHandle interface {
	Stop() bool
}

// RealTimer uses time.AfterFunc.
type RealTimer struct{}

func (RealTimer) AfterFunc(d time.Duration, f func()) TimerHandle {
	return time.AfterFunc(d, f)
}

// reminderState is persisted to prevent duplicate reminders after restart.
type reminderState struct {
	Date         string `json:"date"`
	CheckInSent  bool   `json:"check_in_sent"`
	CheckOutSent bool   `json:"check_out_sent"`
}

const reminderFile = "reminder.json"

// EventEmitter emits Wails events (injected to avoid import cycle).
type EventEmitter interface {
	Emit(name string, data ...interface{})
}

// Scheduler fires desktop notifications at the configured schedule times.
type Scheduler struct {
	clock      Clock
	timer      Timer
	notifier   notification.Notifier
	emitter    EventEmitter
	attendance *attendance.Manager
	store      storage.Store

	mu          sync.Mutex
	activeTimer TimerHandle
	sched       schedule.Schedule
	reminder    reminderState
}

// NewScheduler creates a Scheduler. Call Start() to begin.
func NewScheduler(
	clock Clock,
	timer Timer,
	notifier notification.Notifier,
	emitter EventEmitter,
	attendance *attendance.Manager,
	store storage.Store,
) *Scheduler {
	return &Scheduler{
		clock:      clock,
		timer:      timer,
		notifier:   notifier,
		emitter:    emitter,
		attendance: attendance,
		store:      store,
	}
}

// Start loads persisted reminder state and schedules the first event.
func (s *Scheduler) Start(sched schedule.Schedule) {
	s.mu.Lock()
	s.sched = sched
	s.loadReminderState()
	s.mu.Unlock()
	s.scheduleNext()
}

// UpdateSchedule cancels the current timer and recalculates with the new schedule.
func (s *Scheduler) UpdateSchedule(sched schedule.Schedule) {
	s.mu.Lock()
	s.sched = sched
	s.stopTimerLocked()
	s.mu.Unlock()
	s.scheduleNext()
}

// Stop cancels the current timer.
func (s *Scheduler) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopTimerLocked()
}

// GetNextReminder returns the next scheduled reminder time, or nil if none.
func (s *Scheduler) GetNextReminder() *NextReminder {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.clock.Now()
	et, at, ok := s.sched.NextEvent(now)
	if !ok {
		return nil
	}
	return &NextReminder{
		Type: et.String(),
		At:   at,
	}
}

// NextReminder describes the next scheduled reminder.
type NextReminder struct {
	Type string    `json:"type"` // "check_in" or "check_out"
	At   time.Time `json:"at"`
}

// scheduleNext calculates the next event and sets a timer for it.
func (s *Scheduler) scheduleNext() {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.clock.Now()
	s.refreshReminderStateIfNewDay(now)

	et, at, ok := s.sched.NextEvent(now)
	if !ok {
		return
	}

	// Skip if already sent for this occurrence.
	if s.alreadySent(et) {
		// The already-sent event was for today; skip to after it.
		// Try the event after the current one by searching from at+1min.
		afterAt := at.Add(time.Minute)
		et2, at2, ok2 := s.sched.NextEvent(afterAt)
		if !ok2 {
			return
		}
		et, at = et2, at2
		if s.alreadySent(et) {
			return
		}
	}

	delay := at.Sub(now)
	if delay < 0 {
		delay = 0
	}

	capturedET := et
	s.activeTimer = s.timer.AfterFunc(delay, func() {
		s.onTimer(capturedET)
	})
}

// onTimer is called when the timer fires.
func (s *Scheduler) onTimer(et schedule.EventType) {
	s.mu.Lock()

	now := s.clock.Now()
	s.refreshReminderStateIfNewDay(now)

	if s.alreadySent(et) {
		s.mu.Unlock()
		s.scheduleNext()
		return
	}

	// For check-in: skip notification if user is already checked in today.
	if et == schedule.EventCheckIn && s.attendance != nil && s.attendance.IsCheckedIn() {
		s.markSent(et)
		_ = s.persistReminderState()
		s.mu.Unlock()
		s.scheduleNext()
		return
	}

	// For check-out: skip notification if user is already checked out today.
	if et == schedule.EventCheckOut && s.attendance != nil && s.attendance.IsCheckedOut() {
		s.markSent(et)
		_ = s.persistReminderState()
		s.mu.Unlock()
		s.scheduleNext()
		return
	}

	// Mark as sent before releasing lock.
	s.markSent(et)
	if err := s.persistReminderState(); err != nil {
		log.Printf("scheduler: persist reminder state: %v", err)
	}
	s.mu.Unlock()

	// Send notification outside the lock.
	var title, body string
	switch et {
	case schedule.EventCheckIn:
		title = "Check In Reminder"
		body = "It's time to check in. Click the TimeCheck app."
	case schedule.EventCheckOut:
		title = "Check Out Reminder"
		body = "It's time to check out. Click the TimeCheck app."
	}
	if err := s.notifier.Notify(title, body); err != nil {
		log.Printf("scheduler: notify: %v", err)
	}
	s.emitter.Emit("reminder-triggered", map[string]string{"type": et.String()})

	// Schedule the next event.
	s.scheduleNext()
}

// stopTimerLocked stops the active timer. Caller must hold s.mu.
func (s *Scheduler) stopTimerLocked() {
	if s.activeTimer != nil {
		s.activeTimer.Stop()
		s.activeTimer = nil
	}
}

// alreadySent returns true if the given event type was already sent today.
// Caller must hold s.mu.
func (s *Scheduler) alreadySent(et schedule.EventType) bool {
	switch et {
	case schedule.EventCheckIn:
		return s.reminder.CheckInSent
	case schedule.EventCheckOut:
		return s.reminder.CheckOutSent
	}
	return false
}

// markSent marks the event type as sent. Caller must hold s.mu.
func (s *Scheduler) markSent(et schedule.EventType) {
	switch et {
	case schedule.EventCheckIn:
		s.reminder.CheckInSent = true
	case schedule.EventCheckOut:
		s.reminder.CheckOutSent = true
	}
}

// refreshReminderStateIfNewDay resets reminder state if the day has changed.
// Caller must hold s.mu.
func (s *Scheduler) refreshReminderStateIfNewDay(now time.Time) {
	today := now.Format("2006-01-02")
	if s.reminder.Date != today {
		s.reminder = reminderState{Date: today}
	}
}

// loadReminderState reads persisted reminder state. Caller must hold s.mu.
func (s *Scheduler) loadReminderState() {
	var rs reminderState
	err := s.store.ReadJSON(reminderFile, &rs)
	if err != nil && !errors.Is(err, storage.ErrNotFound) {
		log.Printf("scheduler: load reminder state: %v", err)
		return
	}
	today := s.clock.Now().Format("2006-01-02")
	if rs.Date == today {
		s.reminder = rs
	} else {
		s.reminder = reminderState{Date: today}
	}
}

// persistReminderState saves reminder state. Caller must hold s.mu.
func (s *Scheduler) persistReminderState() error {
	if err := s.store.WriteJSON(reminderFile, s.reminder); err != nil {
		return fmt.Errorf("scheduler: persist: %w", err)
	}
	return nil
}
