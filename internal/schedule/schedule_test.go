package schedule_test

import (
	"testing"
	"time"

	"time-check/internal/schedule"
)

func TestDefaultSettings(t *testing.T) {
	s := schedule.DefaultSettings()
	if s.URL != "https://www.odoo.com/odoo" {
		t.Errorf("expected default URL to be https://www.odoo.com/odoo, got %q", s.URL)
	}
	if !s.Autostart {
		t.Errorf("expected default Autostart to be true")
	}
	if s.GetLogThreshold() != 0 {
		t.Errorf("expected default log threshold to be 0, got %v", s.GetLogThreshold())
	}
}

func TestSettings_GetLogThreshold(t *testing.T) {
	custom := schedule.Settings{
		LogThresholdMinutes: 5,
	}
	if custom.GetLogThreshold() != 5*time.Minute {
		t.Errorf("expected custom log threshold to be 5 min, got %v", custom.GetLogThreshold())
	}

	zero := schedule.Settings{
		LogThresholdMinutes: 0,
	}
	if zero.GetLogThreshold() != 0 {
		t.Errorf("expected zero threshold to be 0, got %v", zero.GetLogThreshold())
	}

	fallback := schedule.Settings{
		LogThresholdMinutes: -1,
	}
	if fallback.GetLogThreshold() != 1*time.Minute {
		t.Errorf("expected fallback threshold to be 1 min, got %v", fallback.GetLogThreshold())
	}
}

func TestParseHHMM(t *testing.T) {
	h, m, err := schedule.ParseHHMM("09:30")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if h != 9 || m != 30 {
		t.Errorf("expected 9:30, got %d:%d", h, m)
	}

	_, _, err = schedule.ParseHHMM("invalid")
	if err == nil {
		t.Errorf("expected error on invalid string")
	}
}
