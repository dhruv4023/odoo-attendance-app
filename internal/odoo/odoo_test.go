package odoo

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClient_FetchStatus(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if auth != "bearer test-key" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}

		switch r.URL.Path {
		case "/json/2/res.users/context_get":
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"uid": 2,
			})
		case "/json/2/hr.employee/search_read":
			_ = json.NewEncoder(w).Encode([]map[string]interface{}{
				{
					"id":               105,
					"name":             "Mitchell Admin",
					"attendance_state": "checked_in",
					"last_check_in":    "2026-09-24 05:30:00",
					"last_check_out":   false,
					"hours_today":      2.5,
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	client := NewClient(ts.URL, "test-key")
	status, err := client.FetchStatus(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !status.Connected {
		t.Errorf("expected Connected=true, got false")
	}
	if status.EmployeeName != "Mitchell Admin" {
		t.Errorf("expected EmployeeName='Mitchell Admin', got %q", status.EmployeeName)
	}
	if status.AttendanceState != "checked_in" {
		t.Errorf("expected AttendanceState='checked_in', got %q", status.AttendanceState)
	}
	if status.LastCheckIn != "2026-09-24 05:30:00" {
		t.Errorf("expected LastCheckIn='2026-09-24 05:30:00', got %q", status.LastCheckIn)
	}
	if status.HoursToday != 2.5 {
		t.Errorf("expected HoursToday=2.5, got %f", status.HoursToday)
	}
}

func TestClient_FetchStatus_Cached(t *testing.T) {
	var contextGetCount int
	var employeeSearchCount int

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/json/2/res.users/context_get":
			contextGetCount++
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"uid": 2})
		case "/json/2/hr.employee/search_read":
			employeeSearchCount++
			_ = json.NewEncoder(w).Encode([]map[string]interface{}{
				{
					"id":               105,
					"name":             "Cached Admin",
					"attendance_state": "checked_out",
					"last_check_in":    "2026-09-24 05:30:00",
					"last_check_out":   "2026-09-24 08:30:00",
					"hours_today":      3.0,
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer ts.Close()

	client := NewClient(ts.URL, "test-key")
	client.SetCachedIDs(2, 105)

	status, err := client.FetchStatus(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if contextGetCount != 0 {
		t.Errorf("expected 0 context_get requests with cached ID, got %d", contextGetCount)
	}
	if employeeSearchCount != 1 {
		t.Errorf("expected exactly 1 employee search_read request with cached ID, got %d", employeeSearchCount)
	}
	if status.EmployeeName != "Cached Admin" {
		t.Errorf("expected EmployeeName='Cached Admin', got %q", status.EmployeeName)
	}
	if status.AttendanceState != "checked_out" {
		t.Errorf("expected AttendanceState='checked_out', got %q", status.AttendanceState)
	}
}

func TestNewClient_BaseURLTrimming(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"https://mycompany.odoo.com/odoo/attendances?view_type=list", "https://mycompany.odoo.com"},
		{"https://mycompany.odoo.com/web#action=123", "https://mycompany.odoo.com"},
		{"http://localhost:8069/some/path", "http://localhost:8069"},
		{"https://odoo.example.com/", "https://odoo.example.com"},
		{"https://odoo.example.com", "https://odoo.example.com"},
	}

	for _, tt := range tests {
		client := NewClient(tt.input, "test-key")
		if client.BaseURL != tt.want {
			t.Errorf("NewClient(%q).BaseURL = %q, want %q", tt.input, client.BaseURL, tt.want)
		}
	}
}
