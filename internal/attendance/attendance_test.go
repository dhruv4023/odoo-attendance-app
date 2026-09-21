package attendance_test

import (
	"errors"
	"testing"
	"time"

	"time-check/internal/attendance"
	"time-check/internal/storage"
)

// fakeClock is a controllable clock for testing.
type fakeClock struct {
	now time.Time
}

func (c *fakeClock) Now() time.Time { return c.now }

func newTestManager(t *testing.T, now time.Time) (*attendance.Manager, *storage.FileStore) {
	t.Helper()
	dir := t.TempDir()
	store, err := storage.NewFileStoreAt(dir)
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	clock := &fakeClock{now: now}
	m, err := attendance.NewManager(store, clock)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return m, store
}

func monday() time.Time {
	return time.Date(2026, 9, 14, 9, 30, 0, 0, time.Local)
}

func TestCheckIn(t *testing.T) {
	m, _ := newTestManager(t, monday())
	if err := m.CheckIn(); err != nil {
		t.Fatalf("CheckIn: %v", err)
	}
	s := m.GetStatus()
	if !s.CheckedIn {
		t.Error("expected CheckedIn=true")
	}
	if len(s.Logs) != 1 || s.Logs[0].Type != "check_in" {
		t.Errorf("expected 1 check_in log entry, got %v", s.Logs)
	}
	if !m.IsCheckedIn() {
		t.Error("expected IsCheckedIn=true")
	}
}

func TestCheckIn_Duplicate(t *testing.T) {
	m, _ := newTestManager(t, monday())
	m.CheckIn()
	err := m.CheckIn()
	if !errors.Is(err, attendance.ErrAlreadyCheckedIn) {
		t.Errorf("expected ErrAlreadyCheckedIn, got %v", err)
	}
}

func TestCheckOut(t *testing.T) {
	m, _ := newTestManager(t, monday())
	m.CheckIn()
	if err := m.CheckOut(); err != nil {
		t.Fatalf("CheckOut: %v", err)
	}
	s := m.GetStatus()
	if !m.IsCheckedOut() {
		t.Error("expected IsCheckedOut=true")
	}
	if len(s.Logs) != 2 || s.Logs[1].Type != "check_out" {
		t.Errorf("expected 2 log entries ending with check_out, got %v", s.Logs)
	}
}

func TestCheckOut_WithoutCheckIn(t *testing.T) {
	m, _ := newTestManager(t, monday())
	err := m.CheckOut()
	if !errors.Is(err, attendance.ErrNotCheckedIn) {
		t.Errorf("expected ErrNotCheckedIn, got %v", err)
	}
}

func TestCheckOut_Duplicate(t *testing.T) {
	m, _ := newTestManager(t, monday())
	m.CheckIn()
	m.CheckOut()
	err := m.CheckOut()
	if !errors.Is(err, attendance.ErrAlreadyCheckedOut) {
		t.Errorf("expected ErrAlreadyCheckedOut, got %v", err)
	}
}

func TestResetIfNewDay(t *testing.T) {
	clock := &fakeClock{now: monday()}
	dir := t.TempDir()
	store, _ := storage.NewFileStoreAt(dir)
	m, _ := attendance.NewManager(store, clock)

	m.CheckIn()
	if !m.IsCheckedIn() {
		t.Fatal("expected checked in")
	}

	// Advance to Tuesday
	clock.now = monday().AddDate(0, 0, 1)
	if err := m.ResetIfNewDay(); err != nil {
		t.Fatalf("ResetIfNewDay: %v", err)
	}

	s := m.GetStatus()
	if s.CheckedIn {
		t.Error("expected CheckedIn reset to false on new day")
	}
}

func TestPersistenceAcrossRestart(t *testing.T) {
	dir := t.TempDir()
	now := monday()

	// First instance: check in.
	store1, _ := storage.NewFileStoreAt(dir)
	clock := &fakeClock{now: now}
	m1, _ := attendance.NewManager(store1, clock)
	m1.CheckIn()

	// Second instance: should restore state.
	store2, _ := storage.NewFileStoreAt(dir)
	m2, err := attendance.NewManager(store2, clock)
	if err != nil {
		t.Fatalf("NewManager (restart): %v", err)
	}
	if !m2.IsCheckedIn() {
		t.Error("expected state to persist across restart")
	}
}

func TestDailyReset_PersistenceAcrossRestart(t *testing.T) {
	dir := t.TempDir()
	monday := time.Date(2026, 9, 14, 9, 0, 0, 0, time.Local)
	tuesday := monday.AddDate(0, 0, 1)

	// Monday: check in.
	store, _ := storage.NewFileStoreAt(dir)
	clock := &fakeClock{now: monday}
	m, _ := attendance.NewManager(store, clock)
	m.CheckIn()

	// Restart on Tuesday.
	clock.now = tuesday
	store2, _ := storage.NewFileStoreAt(dir)
	m2, _ := attendance.NewManager(store2, clock)

	s := m2.GetStatus()
	if s.CheckedIn {
		t.Error("expected daily state to reset on new calendar day after restart")
	}
}

func TestForceCheckOut(t *testing.T) {
	m, _ := newTestManager(t, monday())
	// ForceCheckOut even without a prior check-in.
	if err := m.ForceCheckOut(); err != nil {
		t.Fatalf("ForceCheckOut: %v", err)
	}
	if !m.IsCheckedOut() {
		t.Error("expected IsCheckedOut to be true after ForceCheckOut")
	}
	if len(m.GetStatus().Logs) != 2 {
		t.Errorf("expected 2 logs (check_in + check_out), got %d", len(m.GetStatus().Logs))
	}
}

func TestMultipleCheckInsAndCheckOuts(t *testing.T) {
	m, _ := newTestManager(t, monday())
	// 1. First check-in
	if err := m.CheckIn(); err != nil {
		t.Fatalf("CheckIn 1: %v", err)
	}
	if !m.IsCheckedIn() {
		t.Error("expected IsCheckedIn=true")
	}

	// 2. First check-out
	if err := m.CheckOut(); err != nil {
		t.Fatalf("CheckOut 1: %v", err)
	}
	if !m.IsCheckedOut() {
		t.Error("expected IsCheckedOut=true")
	}

	// 3. Second check-in
	if err := m.CheckIn(); err != nil {
		t.Fatalf("CheckIn 2: %v", err)
	}
	if !m.IsCheckedIn() {
		t.Error("expected IsCheckedIn=true after 2nd checkin")
	}

	// 4. Second check-out
	if err := m.CheckOut(); err != nil {
		t.Fatalf("CheckOut 2: %v", err)
	}
	if !m.IsCheckedOut() {
		t.Error("expected IsCheckedOut=true after 2nd checkout")
	}

	logs := m.GetStatus().Logs
	if len(logs) != 4 {
		t.Fatalf("expected 4 logs recorded, got %d", len(logs))
	}
	if logs[0].Type != "check_in" || logs[1].Type != "check_out" || logs[2].Type != "check_in" || logs[3].Type != "check_out" {
		t.Errorf("unexpected logs sequence: %+v", logs)
	}
}

func TestLastLogTime_And_HasRecentLog(t *testing.T) {
	clock := &fakeClock{now: monday()}
	dir := t.TempDir()
	store, _ := storage.NewFileStoreAt(dir)
	m, _ := attendance.NewManager(store, clock)

	// No logs initially
	if !m.LastLogTime().IsZero() {
		t.Errorf("expected zero LastLogTime when no logs, got %v", m.LastLogTime())
	}
	if m.HasRecentLog(3 * time.Minute) {
		t.Error("expected HasRecentLog to be false when no logs exist")
	}
	if !m.ShouldPromptDialog(3 * time.Minute) {
		t.Error("expected ShouldPromptDialog to be true when no logs exist")
	}

	// Check in at 09:30
	m.CheckIn()
	if m.LastLogTime() != monday() {
		t.Errorf("expected LastLogTime to be %v, got %v", monday(), m.LastLogTime())
	}

	// 2 minutes later (09:32)
	clock.now = monday().Add(2 * time.Minute)
	if !m.HasRecentLog(3 * time.Minute) {
		t.Error("expected HasRecentLog to be true after 2 minutes (threshold 3 min)")
	}
	if m.ShouldPromptDialog(3 * time.Minute) {
		t.Error("expected ShouldPromptDialog to be false after 2 minutes (threshold 3 min)")
	}

	// 3 minutes and 1 second later (09:33:01)
	clock.now = monday().Add(3*time.Minute + 1*time.Second)
	if m.HasRecentLog(3 * time.Minute) {
		t.Error("expected HasRecentLog to be false after > 3 minutes")
	}
	if !m.ShouldPromptDialog(3 * time.Minute) {
		t.Error("expected ShouldPromptDialog to be true after > 3 minutes")
	}

	// User checks out at 09:33:01
	if err := m.CheckOut(); err != nil {
		t.Fatalf("CheckOut: %v", err)
	}

	// Immediately after checkout (< 3 min)
	if !m.HasRecentLog(3 * time.Minute) {
		t.Error("expected HasRecentLog to be true immediately after checkout")
	}
	if m.ShouldPromptDialog(3 * time.Minute) {
		t.Error("expected ShouldPromptDialog to be false immediately after checkout")
	}

	// Advance time 5 minutes past checkout
	clock.now = monday().Add(8 * time.Minute)
	if m.HasRecentLog(3 * time.Minute) {
		t.Error("expected HasRecentLog to be false 5 minutes after checkout")
	}
	if !m.ShouldPromptDialog(3 * time.Minute) {
		t.Error("expected ShouldPromptDialog to be true 5 minutes after checkout")
	}
}
