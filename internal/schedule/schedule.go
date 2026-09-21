// Package schedule defines work schedule types, validation, and next-event calculation.
package schedule

import (
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

// Settings is the top-level persisted application configuration.
type Settings struct {
	URL                 string `json:"url"`
	Autostart           bool   `json:"autostart"`
	LogThresholdMinutes int    `json:"log_threshold_minutes"`
}

// GetLogThreshold returns the threshold duration without a log before showing reminder dialogs.
func (s Settings) GetLogThreshold() time.Duration {
	if s.LogThresholdMinutes <= 0 {
		return 3 * time.Minute
	}
	return time.Duration(s.LogThresholdMinutes) * time.Minute
}

// DefaultSettings returns sensible defaults with default Odoo URL and session checkout threshold.
func DefaultSettings() Settings {
	return Settings{
		URL:                 "https://www.odoo.com/odoo",
		Autostart:           true,
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

// toTimeOnDay combines date parts of base with hour/minute to produce an absolute time.
func toTimeOnDay(base time.Time, hour, minute int) time.Time {
	return time.Date(base.Year(), base.Month(), base.Day(), hour, minute, 0, 0, base.Location())
}

// ParseHHMM parses an HH:MM string and returns the hour and minute.
// Exported for use in other packages.
func ParseHHMM(s string) (hour, minute int, err error) {
	return parseTime(s)
}
