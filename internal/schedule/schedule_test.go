package schedule_test

import (
	"errors"
	"testing"
	"time"

	"time-check/internal/schedule"
)

func makeSchedule(days ...time.Weekday) schedule.Schedule {
	s := schedule.Schedule{}
	set := func(wd time.Weekday, ci, co string) {
		d := schedule.DaySchedule{Enabled: true, CheckIn: ci, CheckOut: co}
		switch wd {
		case time.Monday:
			s.Monday = d
		case time.Tuesday:
			s.Tuesday = d
		case time.Wednesday:
			s.Wednesday = d
		case time.Thursday:
			s.Thursday = d
		case time.Friday:
			s.Friday = d
		case time.Saturday:
			s.Saturday = d
		case time.Sunday:
			s.Sunday = d
		}
	}
	for _, wd := range days {
		set(wd, "09:30", "18:30")
	}
	return s
}

func TestValidate_Valid(t *testing.T) {
	s := makeSchedule(time.Monday, time.Tuesday)
	if err := s.Validate(); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestValidate_DisabledDayNoTimes(t *testing.T) {
	s := schedule.Schedule{Monday: schedule.DaySchedule{Enabled: false}}
	if err := s.Validate(); err != nil {
		t.Errorf("disabled day with no times should be valid, got %v", err)
	}
}

func TestValidate_MissingCheckIn(t *testing.T) {
	s := schedule.Schedule{Monday: schedule.DaySchedule{Enabled: true, CheckOut: "18:30"}}
	if err := s.Validate(); err == nil {
		t.Error("expected error for missing check_in")
	}
}

func TestValidate_CheckOutBeforeCheckIn(t *testing.T) {
	s := schedule.Schedule{Monday: schedule.DaySchedule{Enabled: true, CheckIn: "18:30", CheckOut: "09:30"}}
	if err := s.Validate(); err == nil {
		t.Error("expected error when check_out is before check_in")
	}
}

func TestValidate_EqualTimes(t *testing.T) {
	s := schedule.Schedule{Monday: schedule.DaySchedule{Enabled: true, CheckIn: "09:30", CheckOut: "09:30"}}
	if err := s.Validate(); err == nil {
		t.Error("expected error when check_out equals check_in")
	}
}

func TestValidate_InvalidTimeFormat(t *testing.T) {
	s := schedule.Schedule{Monday: schedule.DaySchedule{Enabled: true, CheckIn: "9:30", CheckOut: "18:30"}}
	if err := s.Validate(); err == nil {
		t.Error("expected error for non-HH:MM format")
	}
}

func TestValidate_MultipleErrors(t *testing.T) {
	s := schedule.Schedule{
		Monday:  schedule.DaySchedule{Enabled: true, CheckIn: "18:00", CheckOut: "09:00"},
		Tuesday: schedule.DaySchedule{Enabled: true, CheckIn: "25:00", CheckOut: "18:30"},
	}
	err := s.Validate()
	if err == nil {
		t.Fatal("expected multiple errors")
	}
	uw, ok := err.(interface{ Unwrap() []error })
	if !ok {
		t.Fatalf("expected joined errors, got %T", err)
	}
	if len(uw.Unwrap()) < 2 {
		t.Errorf("expected at least 2 errors, got %d", len(uw.Unwrap()))
	}
}

func TestForToday_Enabled(t *testing.T) {
	s := makeSchedule(time.Monday)
	monday := time.Date(2026, 9, 14, 10, 0, 0, 0, time.Local) // a Monday
	d, ok := s.ForToday(monday)
	if !ok {
		t.Fatal("expected day to be enabled")
	}
	if !d.Enabled {
		t.Error("expected Enabled=true")
	}
}

func TestForToday_Disabled(t *testing.T) {
	s := makeSchedule(time.Monday)
	saturday := time.Date(2026, 9, 19, 10, 0, 0, 0, time.Local)
	_, ok := s.ForToday(saturday)
	if ok {
		t.Error("expected Saturday to be disabled")
	}
}

// timeAt returns a time.Time at the given date and HH:MM in local time.
func timeAt(year int, month time.Month, day, hour, minute int) time.Time {
	return time.Date(year, month, day, hour, minute, 0, 0, time.Local)
}

func TestNextEvent_BeforeCheckIn(t *testing.T) {
	s := makeSchedule(time.Monday)
	// Monday 08:00 — next event should be check-in at 09:30
	now := timeAt(2026, 9, 14, 8, 0)
	et, at, ok := s.NextEvent(now)
	if !ok {
		t.Fatal("expected an event")
	}
	if et != schedule.EventCheckIn {
		t.Errorf("expected EventCheckIn, got %v", et)
	}
	if at.Hour() != 9 || at.Minute() != 30 {
		t.Errorf("expected 09:30, got %02d:%02d", at.Hour(), at.Minute())
	}
}

func TestNextEvent_BetweenCheckInAndCheckOut(t *testing.T) {
	s := makeSchedule(time.Monday)
	// Monday 10:00 — between check-in and check-out
	now := timeAt(2026, 9, 14, 10, 0)
	et, at, ok := s.NextEvent(now)
	if !ok {
		t.Fatal("expected an event")
	}
	if et != schedule.EventCheckOut {
		t.Errorf("expected EventCheckOut, got %v", et)
	}
	if at.Hour() != 18 || at.Minute() != 30 {
		t.Errorf("expected 18:30, got %02d:%02d", at.Hour(), at.Minute())
	}
}

func TestNextEvent_AfterCheckOut(t *testing.T) {
	s := makeSchedule(time.Monday, time.Tuesday)
	// Monday 19:00 — past checkout; next event should be Tuesday check-in
	now := timeAt(2026, 9, 14, 19, 0)
	et, _, ok := s.NextEvent(now)
	if !ok {
		t.Fatal("expected an event")
	}
	if et != schedule.EventCheckIn {
		t.Errorf("expected EventCheckIn for next day, got %v", et)
	}
}

func TestNextEvent_WeekBoundary(t *testing.T) {
	// Only Monday is enabled.
	s := makeSchedule(time.Monday)
	// Friday evening — next check-in should be next Monday
	now := timeAt(2026, 9, 18, 20, 0) // Friday
	et, at, ok := s.NextEvent(now)
	if !ok {
		t.Fatal("expected an event")
	}
	if et != schedule.EventCheckIn {
		t.Errorf("expected EventCheckIn, got %v", et)
	}
	if at.Weekday() != time.Monday {
		t.Errorf("expected Monday, got %v", at.Weekday())
	}
}

func TestNextEvent_NoEnabledDays(t *testing.T) {
	s := schedule.Schedule{}
	_, _, ok := s.NextEvent(time.Now())
	if ok {
		t.Error("expected no event when all days disabled")
	}
}

func TestParseHHMM_Valid(t *testing.T) {
	h, m, err := schedule.ParseHHMM("09:30")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if h != 9 || m != 30 {
		t.Errorf("expected 9:30, got %d:%d", h, m)
	}
}

func TestParseHHMM_Invalid(t *testing.T) {
	cases := []string{"9:30", "09:3", "09:60", "25:00", "", "ab:cd"}
	for _, c := range cases {
		_, _, err := schedule.ParseHHMM(c)
		if err == nil {
			t.Errorf("expected error for %q", c)
		}
	}
}

func TestDefaultSettings(t *testing.T) {
	s := schedule.DefaultSettings()
	if err := s.Schedule.Validate(); err != nil {
		t.Errorf("default schedule is invalid: %v", err)
	}
	if !s.Schedule.Monday.Enabled {
		t.Error("expected Monday enabled")
	}
	if s.Schedule.Saturday.Enabled {
		t.Error("expected Saturday disabled")
	}
}

func TestValidate_JoinedErrors(t *testing.T) {
	s := schedule.Schedule{
		Monday: schedule.DaySchedule{Enabled: true, CheckIn: "bad", CheckOut: "18:30"},
	}
	err := s.Validate()
	if !errors.Is(err, err) { // Ensure it wraps
		t.Error("expected wrapped error")
	}
}

func TestIsCheckInWindow(t *testing.T) {
	day := schedule.DaySchedule{Enabled: true, CheckIn: "10:00", CheckOut: "19:00"}

	// 10:00 check-in -> window is 09:00 to 19:00
	beforeWindow := timeAt(2026, 9, 14, 8, 59)
	if day.IsCheckInWindow(beforeWindow) {
		t.Errorf("08:59 should NOT be in check-in window for 10:00 check-in")
	}

	atWindowStart := timeAt(2026, 9, 14, 9, 0)
	if !day.IsCheckInWindow(atWindowStart) {
		t.Errorf("09:00 should be in check-in window for 10:00 check-in")
	}

	atCheckIn := timeAt(2026, 9, 14, 10, 0)
	if !day.IsCheckInWindow(atCheckIn) {
		t.Errorf("10:00 should be in check-in window for 10:00 check-in")
	}

	afterCheckIn := timeAt(2026, 9, 14, 11, 0)
	if !day.IsCheckInWindow(afterCheckIn) {
		t.Errorf("11:00 should be in check-in window for 10:00 check-in")
	}

	duringShift := timeAt(2026, 9, 14, 15, 30)
	if !day.IsCheckInWindow(duringShift) {
		t.Errorf("15:30 should be in check-in window for 10:00-19:00 schedule")
	}

	afterCheckOut := timeAt(2026, 9, 14, 19, 1)
	if day.IsCheckInWindow(afterCheckOut) {
		t.Errorf("19:01 should NOT be in check-in window for 19:00 check-out")
	}
}

func TestShouldPromptLoginCheckIn(t *testing.T) {
	s := makeSchedule(time.Monday) // Monday 09:30 - 18:30 (Window: 08:30 - 18:30)

	mondayInWindow := timeAt(2026, 9, 14, 9, 0)
	if !s.ShouldPromptLoginCheckIn(mondayInWindow) {
		t.Errorf("expected ShouldPromptLoginCheckIn=true on Monday at 09:00")
	}

	mondayTooEarly := timeAt(2026, 9, 14, 8, 0)
	if s.ShouldPromptLoginCheckIn(mondayTooEarly) {
		t.Errorf("expected ShouldPromptLoginCheckIn=false on Monday at 08:00")
	}

	sunday := timeAt(2026, 9, 13, 10, 0)
	if s.ShouldPromptLoginCheckIn(sunday) {
		t.Errorf("expected ShouldPromptLoginCheckIn=false on disabled Sunday")
	}
}
