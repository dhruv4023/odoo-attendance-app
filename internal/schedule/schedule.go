// Package schedule defines work schedule types, validation, and next-event calculation.
package schedule

import (
	"time"
)

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

type Settings struct {
	URL                 string `json:"url"`
	APIKey              string `json:"api_key"`
	OdooSyncEnabled     bool   `json:"odoo_sync_enabled"`
	Autostart           bool   `json:"autostart"`
	LogThresholdMinutes int    `json:"log_threshold_minutes"`
	UserID              int    `json:"user_id,omitempty"`
	EmployeeID          int    `json:"employee_id,omitempty"`
	EmployeeName        string `json:"employee_name,omitempty"`
}

func (s Settings) GetLogThreshold() time.Duration {
	if s.LogThresholdMinutes < 0 {
		return 1 * time.Minute
	}
	return time.Duration(s.LogThresholdMinutes) * time.Minute
}

func DefaultSettings() Settings {
	return Settings{
		URL:                 "https://www.odoo.com/odoo",
		APIKey:              "",
		OdooSyncEnabled:     false,
		Autostart:           false,
		LogThresholdMinutes: 0,
	}
}
