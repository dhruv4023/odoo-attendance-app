// Package attendance manages the daily check-in/check-out state.
package attendance

import (
	"errors"
	"fmt"
	"time"

	"time-check/internal/storage"
)

// ErrAlreadyCheckedIn is returned when CheckIn is called but already checked in today.
var ErrAlreadyCheckedIn = errors.New("attendance: already checked in today")

// ErrAlreadyCheckedOut is returned when CheckOut is called but already checked out today.
var ErrAlreadyCheckedOut = errors.New("attendance: already checked out today")

// ErrNotCheckedIn is returned when CheckOut is called without a prior CheckIn.
var ErrNotCheckedIn = errors.New("attendance: not checked in")

// LogEntry represents an individual check-in or check-out timestamp record.
type LogEntry struct {
	Type      string    `json:"type"`      // "check_in" or "check_out"
	Timestamp time.Time `json:"timestamp"` // exact recorded timestamp
}

// DailyStatus represents the persisted check-in/check-out state for one day.
type DailyStatus struct {
	Date      string     `json:"date"`
	CheckedIn bool       `json:"checked_in"`
	Logs      []LogEntry `json:"logs,omitempty"`
}

const statusFile = "status.json"

// Clock is an injectable time source for testing.
type Clock interface {
	Now() time.Time
}

// RealClock uses the actual system clock.
type RealClock struct{}

func (RealClock) Now() time.Time { return time.Now() }

// Manager manages daily attendance state with persistence.
type Manager struct {
	store  storage.Store
	clock  Clock
	status DailyStatus
}

// NewManager creates a new Manager. It loads any persisted state from the store.
func NewManager(store storage.Store, clock Clock) (*Manager, error) {
	m := &Manager{store: store, clock: clock}
	if err := m.load(); err != nil {
		return nil, err
	}
	return m, nil
}

// load reads persisted status and resets if the date has changed.
func (m *Manager) load() error {
	var s DailyStatus
	err := m.store.ReadJSON(statusFile, &s)
	if err != nil && !errors.Is(err, storage.ErrNotFound) {
		return fmt.Errorf("attendance: load: %w", err)
	}
	today := m.clock.Now().Format("2006-01-02")
	if s.Date != today {
		// New day — start fresh.
		s = DailyStatus{Date: today}
	}
	m.status = s
	return nil
}

// ResetIfNewDay checks if the calendar date has changed and resets if so.
func (m *Manager) ResetIfNewDay() error {
	today := m.clock.Now().Format("2006-01-02")
	if m.status.Date == today {
		return nil
	}
	m.status = DailyStatus{Date: today}
	return m.store.WriteJSON(statusFile, m.status)
}

// GetStatus returns a copy of the current daily status.
func (m *Manager) GetStatus() DailyStatus {
	return m.status
}

// IsCheckedIn returns whether the user has checked in today.
func (m *Manager) IsCheckedIn() bool { return m.status.CheckedIn }

// IsCheckedOut returns whether the user has checked out today.
func (m *Manager) IsCheckedOut() bool {
	if len(m.status.Logs) == 0 {
		return false
	}
	return m.status.Logs[len(m.status.Logs)-1].Type == "check_out"
}

// CheckIn records the check-in time. Returns ErrAlreadyCheckedIn if already checked in.
func (m *Manager) CheckIn() error {
	if err := m.ResetIfNewDay(); err != nil {
		return err
	}
	if m.status.CheckedIn {
		return ErrAlreadyCheckedIn
	}
	now := m.clock.Now()
	m.status.CheckedIn = true
	m.status.Logs = append(m.status.Logs, LogEntry{
		Type:      "check_in",
		Timestamp: now,
	})
	return m.store.WriteJSON(statusFile, m.status)
}

// CheckOut records the check-out time. Returns an error if not checked in or already checked out.
func (m *Manager) CheckOut() error {
	if err := m.ResetIfNewDay(); err != nil {
		return err
	}
	if !m.status.CheckedIn {
		return ErrNotCheckedIn
	}
	if m.IsCheckedOut() {
		return ErrAlreadyCheckedOut
	}
	now := m.clock.Now()
	m.status.Logs = append(m.status.Logs, LogEntry{
		Type:      "check_out",
		Timestamp: now,
	})
	return m.store.WriteJSON(statusFile, m.status)
}

// LastLogTime returns the timestamp of the most recent log entry today, or a zero time.Time if no logs exist.
func (m *Manager) LastLogTime() time.Time {
	if len(m.status.Logs) == 0 {
		return time.Time{}
	}
	return m.status.Logs[len(m.status.Logs)-1].Timestamp
}

// HasRecentLog returns true if a log entry was added within the threshold duration from now.
func (m *Manager) HasRecentLog(threshold time.Duration) bool {
	last := m.LastLogTime()
	if last.IsZero() {
		return false
	}
	diff := m.clock.Now().Sub(last)
	return diff >= 0 && diff < threshold
}

// ShouldPromptDialog returns true if no log entry was added within the threshold duration.
func (m *Manager) ShouldPromptDialog(threshold time.Duration) bool {
	return !m.HasRecentLog(threshold)
}

// ForceCheckOut records a check-out regardless of current state (used from shutdown dialog).
// It will set CheckedIn if not set, then record the check-out.
func (m *Manager) ForceCheckOut() error {
	if err := m.ResetIfNewDay(); err != nil {
		return err
	}
	now := m.clock.Now()
	if !m.status.CheckedIn {
		m.status.CheckedIn = true
		m.status.Logs = append(m.status.Logs, LogEntry{
			Type:      "check_in",
			Timestamp: now,
		})
	}
	m.status.Logs = append(m.status.Logs, LogEntry{
		Type:      "check_out",
		Timestamp: now,
	})
	return m.store.WriteJSON(statusFile, m.status)
}

