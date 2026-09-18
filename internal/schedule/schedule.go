// Package schedule defines work schedule types, validation, and next-event calculation.
package schedule

import (
	"errors"
	"fmt"
	"time"
)

// EventType identifies whether a scheduled event is a check-in or check-out.
type EventType int

const (
	EventCheckIn  EventType = iota
	EventCheckOut EventType = iota
)

func (e EventType) String() string {
	if e == EventCheckIn {
		return "check_in"
	}
	return "check_out"
}

// DaySchedule holds the check-in and check-out times for a single day.
type DaySchedule struct {
	Enabled  bool   `json:"enabled"`
	CheckIn  string `json:"check_in"`  // HH:MM
	CheckOut string `json:"check_out"` // HH:MM
}

// Schedule holds the work schedule for each day of the week.
type Schedule struct {
	Monday    DaySchedule `json:"monday"`
	Tuesday   DaySchedule `json:"tuesday"`
	Wednesday DaySchedule `json:"wednesday"`
	Thursday  DaySchedule `json:"thursday"`
	Friday    DaySchedule `json:"friday"`
	Saturday  DaySchedule `json:"saturday"`
	Sunday    DaySchedule `json:"sunday"`
}

// Settings is the top-level persisted application configuration.
type Settings struct {
	Schedule            Schedule `json:"schedule"`
	URL                 string   `json:"url"`
	Autostart           bool     `json:"autostart"`
	LogThresholdMinutes int      `json:"log_threshold_minutes"`
}

// GetLogThreshold returns the threshold duration without a log before showing reminder dialogs.
func (s Settings) GetLogThreshold() time.Duration {
	if s.LogThresholdMinutes <= 0 {
		return 3 * time.Minute
	}
	return time.Duration(s.LogThresholdMinutes) * time.Minute
}

// DefaultSettings returns sensible defaults (Mon–Fri 10:00–19:00 with autostart enabled).
func DefaultSettings() Settings {
	day := DaySchedule{Enabled: true, CheckIn: "10:00", CheckOut: "19:00"}
	return Settings{
		Schedule: Schedule{
			Monday:    day,
			Tuesday:   day,
			Wednesday: day,
			Thursday:  day,
			Friday:    day,
			Saturday:  DaySchedule{Enabled: false},
			Sunday:    DaySchedule{Enabled: false},
		},
		URL:                 "https://example.com/attendance",
		Autostart:           false,
		LogThresholdMinutes: 3,
	}
}


// parseTime parses a "HH:MM" string and returns the hour and minute.
func parseTime(s string) (hour, minute int, err error) {
	if len(s) != 5 || s[2] != ':' {
		return 0, 0, fmt.Errorf("invalid time %q, expected HH:MM", s)
	}
	var h, m int
	if _, err := fmt.Sscanf(s, "%d:%d", &h, &m); err != nil {
		return 0, 0, fmt.Errorf("invalid time %q: %w", s, err)
	}
	if h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, 0, fmt.Errorf("time %q out of range", s)
	}
	return h, m, nil
}

// validateDay validates a single DaySchedule entry.
func validateDay(name string, d DaySchedule) error {
	if !d.Enabled {
		return nil
	}
	if d.CheckIn == "" {
		return fmt.Errorf("%s: check_in time is required when day is enabled", name)
	}
	if d.CheckOut == "" {
		return fmt.Errorf("%s: check_out time is required when day is enabled", name)
	}
	ih, im, err := parseTime(d.CheckIn)
	if err != nil {
		return fmt.Errorf("%s check_in: %w", name, err)
	}
	oh, om, err := parseTime(d.CheckOut)
	if err != nil {
		return fmt.Errorf("%s check_out: %w", name, err)
	}
	inMinutes := ih*60 + im
	outMinutes := oh*60 + om
	if outMinutes <= inMinutes {
		return fmt.Errorf("%s: check_out (%s) must be after check_in (%s)", name, d.CheckOut, d.CheckIn)
	}
	return nil
}

// Validate validates the entire schedule. Returns a joined error if any day fails.
func (s Schedule) Validate() error {
	var errs []error
	days := []struct {
		name string
		day  DaySchedule
	}{
		{"monday", s.Monday},
		{"tuesday", s.Tuesday},
		{"wednesday", s.Wednesday},
		{"thursday", s.Thursday},
		{"friday", s.Friday},
		{"saturday", s.Saturday},
		{"sunday", s.Sunday},
	}
	for _, d := range days {
		if err := validateDay(d.name, d.day); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// dayForWeekday returns the DaySchedule for the given weekday.
func (s Schedule) dayForWeekday(wd time.Weekday) DaySchedule {
	switch wd {
	case time.Monday:
		return s.Monday
	case time.Tuesday:
		return s.Tuesday
	case time.Wednesday:
		return s.Wednesday
	case time.Thursday:
		return s.Thursday
	case time.Friday:
		return s.Friday
	case time.Saturday:
		return s.Saturday
	case time.Sunday:
		return s.Sunday
	}
	return DaySchedule{}
}

// ForToday returns the DaySchedule for the current day of the week.
// The second return value indicates whether the day has a schedule.
func (s Schedule) ForToday(t time.Time) (DaySchedule, bool) {
	d := s.dayForWeekday(t.Weekday())
	return d, d.Enabled
}

// toTimeOnDay combines date parts of base with hour/minute to produce an absolute time.
func toTimeOnDay(base time.Time, hour, minute int) time.Time {
	return time.Date(base.Year(), base.Month(), base.Day(), hour, minute, 0, 0, base.Location())
}

// NextEvent returns the next scheduled event (check-in or check-out) starting from t.
// It searches up to 8 days ahead to handle week boundaries and disabled days.
// Returns (eventType, eventTime, true) or (_, _, false) if no events are scheduled.
func (s Schedule) NextEvent(t time.Time) (EventType, time.Time, bool) {
	// Search up to 8 days from now.
	for offset := 0; offset <= 7; offset++ {
		candidate := t.AddDate(0, 0, offset)
		day := s.dayForWeekday(candidate.Weekday())
		if !day.Enabled {
			continue
		}

		ih, im, err := parseTime(day.CheckIn)
		if err != nil {
			continue
		}
		oh, om, err := parseTime(day.CheckOut)
		if err != nil {
			continue
		}

		checkInTime := toTimeOnDay(candidate, ih, im)
		checkOutTime := toTimeOnDay(candidate, oh, om)

		if t.Before(checkInTime) {
			return EventCheckIn, checkInTime, true
		}
		if t.Before(checkOutTime) {
			return EventCheckOut, checkOutTime, true
		}
		// Both events for this day have passed; try next day.
	}
	return EventCheckIn, time.Time{}, false
}

// NextCheckInTime returns the next check-in time at or after t.
func (s Schedule) NextCheckInTime(t time.Time) (time.Time, bool) {
	for offset := 0; offset <= 7; offset++ {
		candidate := t.AddDate(0, 0, offset)
		day := s.dayForWeekday(candidate.Weekday())
		if !day.Enabled {
			continue
		}
		ih, im, err := parseTime(day.CheckIn)
		if err != nil {
			continue
		}
		checkInTime := toTimeOnDay(candidate, ih, im)
		if !t.After(checkInTime) {
			return checkInTime, true
		}
	}
	return time.Time{}, false
}

// IsCheckInWindow returns true if t is within the eligible check-in window for this day.
// The check-in window starts 1 hour before the configured check-in time (e.g., 09:00 for a 10:00 check-in)
// and extends through the scheduled work period (up to check-out time, or at least 1 hour after check-in).
func (d DaySchedule) IsCheckInWindow(t time.Time) bool {
	if !d.Enabled {
		return false
	}
	ih, im, err := parseTime(d.CheckIn)
	if err != nil {
		return false
	}
	checkInTime := toTimeOnDay(t, ih, im)
	windowStart := checkInTime.Add(-1 * time.Hour)

	windowEnd := checkInTime.Add(1 * time.Hour)
	if oh, om, err := parseTime(d.CheckOut); err == nil {
		checkOutTime := toTimeOnDay(t, oh, om)
		if checkOutTime.After(windowEnd) {
			windowEnd = checkOutTime
		}
	}

	return !t.Before(windowStart) && !t.After(windowEnd)
}

// ShouldPromptLoginCheckIn returns true if the current time t is within the check-in window for today's schedule.
func (s Schedule) ShouldPromptLoginCheckIn(t time.Time) bool {
	day, enabled := s.ForToday(t)
	if !enabled {
		return false
	}
	return day.IsCheckInWindow(t)
}

// ParseHHMM parses an HH:MM string and returns the hour and minute.
// Exported for use in other packages.
func ParseHHMM(s string) (hour, minute int, err error) {
	return parseTime(s)
}
