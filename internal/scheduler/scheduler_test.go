package scheduler_test

import (
	"sync"
	"testing"
	"time"

	"time-check/internal/attendance"
	"time-check/internal/schedule"
	"time-check/internal/scheduler"
	"time-check/internal/storage"
)

// --- Fakes ---

type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Set(t time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = t
}

// fakeTimerHandle is a cancelable timer that fires after a delay via goroutine.
type fakeTimerHandle struct {
	stopped chan struct{}
	once    sync.Once
}

func (h *fakeTimerHandle) Stop() bool {
	stopped := false
	h.once.Do(func() {
		close(h.stopped)
		stopped = true
	})
	return stopped
}

// fakeTimer is a controllable timer factory.
type fakeTimer struct {
	mu     sync.Mutex
	timers []*fakeTimerHandle
	fired  []time.Duration
}

func (ft *fakeTimer) AfterFunc(d time.Duration, f func()) scheduler.TimerHandle {
	h := &fakeTimerHandle{stopped: make(chan struct{})}
	ft.mu.Lock()
	ft.timers = append(ft.timers, h)
	ft.fired = append(ft.fired, d)
	ft.mu.Unlock()
	// Fire immediately in goroutine if duration <= 0 or run in goroutine.
	go func() {
		select {
		case <-h.stopped:
			return
		case <-time.After(d):
			// Check if stopped after delay.
			select {
			case <-h.stopped:
				return
			default:
				f()
			}
		}
	}()
	return h
}

func (ft *fakeTimer) FireAll() {
	ft.mu.Lock()
	hs := make([]*fakeTimerHandle, len(ft.timers))
	copy(hs, ft.timers)
	ft.mu.Unlock()
	for _, h := range hs {
		select {
		case <-h.stopped:
		default:
		}
	}
}

// immediateTimer fires all timers immediately (0 duration).
type immediateTimer struct{}

func (t immediateTimer) AfterFunc(d time.Duration, f func()) scheduler.TimerHandle {
	h := &fakeTimerHandle{stopped: make(chan struct{})}
	go func() {
		select {
		case <-h.stopped:
			return
		default:
			f()
		}
	}()
	return h
}

type fakeNotifier struct {
	mu    sync.Mutex
	calls []string
}

func (n *fakeNotifier) Notify(title, body string) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.calls = append(n.calls, title)
	return nil
}

func (n *fakeNotifier) Count() int {
	n.mu.Lock()
	defer n.mu.Unlock()
	return len(n.calls)
}

type fakeEmitter struct {
	mu     sync.Mutex
	events []string
}

func (e *fakeEmitter) Emit(name string, data ...interface{}) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.events = append(e.events, name)
}

func (e *fakeEmitter) Has(name string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, ev := range e.events {
		if ev == name {
			return true
		}
	}
	return false
}

// --- Helpers ---

func mondaySchedule() schedule.Schedule {
	day := schedule.DaySchedule{Enabled: true, CheckIn: "09:30", CheckOut: "18:30"}
	return schedule.Schedule{
		Monday: day, Tuesday: day, Wednesday: day,
		Thursday: day, Friday: day,
	}
}

func newTestScheduler(t *testing.T, now time.Time) (*scheduler.Scheduler, *fakeClock, *fakeNotifier, *fakeEmitter) {
	t.Helper()
	dir := t.TempDir()
	store, _ := storage.NewFileStoreAt(dir)
	clock := &fakeClock{now: now}
	att, _ := attendance.NewManager(store, clock)
	notifier := &fakeNotifier{}
	emitter := &fakeEmitter{}

	// Use a non-firing timer by default (we test logic not real time).
	timer := &fakeTimer{}
	s := scheduler.NewScheduler(clock, timer, notifier, emitter, att, store)
	_ = timer // keep reference if needed
	return s, clock, notifier, emitter
}

// --- Tests ---

func TestScheduler_GetNextReminder_BeforeCheckIn(t *testing.T) {
	// Monday 08:00 — should show check-in at 09:30
	now := time.Date(2026, 9, 14, 8, 0, 0, 0, time.Local)
	s, _, _, _ := newTestScheduler(t, now)
	s.Start(mondaySchedule())

	nr := s.GetNextReminder()
	if nr == nil {
		t.Fatal("expected a next reminder")
	}
	if nr.Type != "check_in" {
		t.Errorf("expected check_in, got %s", nr.Type)
	}
	if nr.At.Hour() != 9 || nr.At.Minute() != 30 {
		t.Errorf("expected 09:30, got %02d:%02d", nr.At.Hour(), nr.At.Minute())
	}
}

func TestScheduler_GetNextReminder_NoSchedule(t *testing.T) {
	now := time.Date(2026, 9, 14, 8, 0, 0, 0, time.Local)
	s, _, _, _ := newTestScheduler(t, now)
	s.Start(schedule.Schedule{}) // all disabled
	nr := s.GetNextReminder()
	if nr != nil {
		t.Errorf("expected nil next reminder when no days enabled, got %+v", nr)
	}
}

func TestScheduler_UpdateSchedule_StopsOldTimer(t *testing.T) {
	now := time.Date(2026, 9, 14, 8, 0, 0, 0, time.Local)
	dir := t.TempDir()
	store, _ := storage.NewFileStoreAt(dir)
	clock := &fakeClock{now: now}
	att, _ := attendance.NewManager(store, clock)
	notifier := &fakeNotifier{}
	emitter := &fakeEmitter{}

	ft := &fakeTimer{}
	s := scheduler.NewScheduler(clock, ft, notifier, emitter, att, store)
	s.Start(mondaySchedule())

	initialTimerCount := len(ft.timers)
	if initialTimerCount == 0 {
		t.Fatal("expected at least one timer after Start")
	}

	// Update schedule — should create a new timer.
	s.UpdateSchedule(mondaySchedule())
	if len(ft.timers) <= initialTimerCount {
		t.Error("expected new timer after UpdateSchedule")
	}
}

func TestScheduler_Stop(t *testing.T) {
	now := time.Date(2026, 9, 14, 8, 0, 0, 0, time.Local)
	dir := t.TempDir()
	store, _ := storage.NewFileStoreAt(dir)
	clock := &fakeClock{now: now}
	att, _ := attendance.NewManager(store, clock)
	notifier := &fakeNotifier{}
	emitter := &fakeEmitter{}
	ft := &fakeTimer{}
	s := scheduler.NewScheduler(clock, ft, notifier, emitter, att, store)
	s.Start(mondaySchedule())
	s.Stop() // Should not panic.
}

func TestScheduler_ReminderTriggered(t *testing.T) {
	// Set time to exactly check-in time — timer should fire immediately (0 delay).
	now := time.Date(2026, 9, 14, 9, 30, 0, 0, time.Local)
	dir := t.TempDir()
	store, _ := storage.NewFileStoreAt(dir)
	clock := &fakeClock{now: now}
	att, _ := attendance.NewManager(store, clock)
	notifier := &fakeNotifier{}
	emitter := &fakeEmitter{}

	s := scheduler.NewScheduler(clock, immediateTimer{}, notifier, emitter, att, store)
	s.Start(mondaySchedule())
	defer s.Stop()

	// Allow goroutines to run.
	for i := 0; i < 20; i++ {
		if notifier.Count() > 0 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	if notifier.Count() == 0 {
		t.Error("expected notification to have fired")
	}
}

func TestScheduler_NoDuplicateReminder_SameDay(t *testing.T) {
	// Mark check-in already sent; immediate timer should NOT re-send.
	now := time.Date(2026, 9, 14, 9, 30, 0, 0, time.Local)
	dir := t.TempDir()
	store, _ := storage.NewFileStoreAt(dir)

	// Pre-populate reminder state as already sent.
	type rs struct {
		Date        string `json:"date"`
		CheckInSent bool   `json:"check_in_sent"`
	}
	store.WriteJSON("reminder.json", rs{Date: "2026-09-14", CheckInSent: true})

	clock := &fakeClock{now: now}
	att, _ := attendance.NewManager(store, clock)
	notifier := &fakeNotifier{}
	emitter := &fakeEmitter{}

	s := scheduler.NewScheduler(clock, immediateTimer{}, notifier, emitter, att, store)
	s.Start(mondaySchedule())
	defer s.Stop()

	time.Sleep(50 * time.Millisecond)

	// Should not have sent check-in again; may have fired check-out timer instead.
	calls := notifier.calls
	for _, c := range calls {
		if c == "Check In Reminder" {
			t.Error("check-in reminder should not re-fire after being marked sent")
		}
	}
}

func TestScheduler_ReminderEmitsEvent(t *testing.T) {
	now := time.Date(2026, 9, 14, 9, 30, 0, 0, time.Local)
	dir := t.TempDir()
	store, _ := storage.NewFileStoreAt(dir)
	clock := &fakeClock{now: now}
	att, _ := attendance.NewManager(store, clock)
	notifier := &fakeNotifier{}
	emitter := &fakeEmitter{}

	s := scheduler.NewScheduler(clock, immediateTimer{}, notifier, emitter, att, store)
	s.Start(mondaySchedule())
	defer s.Stop()

	for i := 0; i < 20; i++ {
		if emitter.Has("reminder-triggered") {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	if !emitter.Has("reminder-triggered") {
		t.Error("expected reminder-triggered event to be emitted")
	}
}

func TestScheduler_SkipsReminder_WhenAlreadyCheckedIn(t *testing.T) {
	now := time.Date(2026, 9, 14, 9, 30, 0, 0, time.Local)
	dir := t.TempDir()
	store, _ := storage.NewFileStoreAt(dir)
	clock := &fakeClock{now: now}
	att, _ := attendance.NewManager(store, clock)
	_ = att.CheckIn() // user already checked in before scheduled time
	notifier := &fakeNotifier{}
	emitter := &fakeEmitter{}

	s := scheduler.NewScheduler(clock, immediateTimer{}, notifier, emitter, att, store)
	s.Start(mondaySchedule())
	defer s.Stop()

	time.Sleep(50 * time.Millisecond)

	for _, c := range notifier.calls {
		if c == "Check In Reminder" {
			t.Error("expected check-in notification to be skipped when user is already checked in")
		}
	}
}
