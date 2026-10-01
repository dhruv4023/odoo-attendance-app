package schedule_test

import (
	"testing"
	"time"

	"odoo-attendance-app/internal/schedule"
)


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

func TestEventType_String(t *testing.T) {
	if schedule.EventCheckIn.String() != "check_in" {
		t.Errorf("expected check_in, got %s", schedule.EventCheckIn.String())
	}
	if schedule.EventCheckOut.String() != "check_out" {
		t.Errorf("expected check_out, got %s", schedule.EventCheckOut.String())
	}
}
