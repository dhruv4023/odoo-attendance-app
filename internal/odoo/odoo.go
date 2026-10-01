// Package odoo provides JSON-RPC / REST client for Odoo attendance operations.
package odoo

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var (
	ErrNoEmployeeLinked = errors.New("odoo: no employee linked to this user")
	ErrNoOpenAttendance = errors.New("odoo: no open attendance record found to check out")
)

// Client interacts with the Odoo JSON-2 API.
type Client struct {
	BaseURL    string
	APIKey     string
	HTTPClient *http.Client
	UserID     int
	EmployeeID int
}

func NewClient(baseURL, apiKey string) *Client {
	baseURL = strings.TrimSpace(baseURL)
	if u, err := url.Parse(baseURL); err == nil && u.Scheme != "" && u.Host != "" {
		baseURL = u.Scheme + "://" + u.Host
	} else {
		baseURL = strings.TrimRight(baseURL, "/")
	}

	return &Client{
		BaseURL: baseURL,
		APIKey:  strings.TrimSpace(apiKey),
		HTTPClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

func (c *Client) SetCachedIDs(uid, empID int) {
	c.UserID = uid
	c.EmployeeID = empID
}

type ContextResponse struct {
	UID int `json:"uid"`
}

type Employee struct {
	ID              int         `json:"id"`
	Name            string      `json:"name"`
	AttendanceState string      `json:"attendance_state"` // "checked_in" or "checked_out"
	LastCheckIn     interface{} `json:"last_check_in"`    // string timestamp or false/nil
	LastCheckOut    interface{} `json:"last_check_out"`   // string timestamp or false/nil
	HoursToday      float64     `json:"hours_today"`
	TotalOvertime   float64     `json:"total_overtime"`
}

// AttendanceRecord represents an Odoo hr.attendance record.
type AttendanceRecord struct {
	ID          int         `json:"id"`
	CheckIn     interface{} `json:"check_in"`
	CheckOut    interface{} `json:"check_out"`
	WorkedHours float64     `json:"worked_hours"`
}

// OdooStatus is the aggregated status returned to the frontend.
type OdooStatus struct {
	Connected         bool               `json:"connected"`
	EmployeeName      string             `json:"employee_name"`
	EmployeeID        int                `json:"employee_id"`
	UserID            int                `json:"user_id"`
	AttendanceState   string             `json:"attendance_state"` // "checked_in" or "checked_out"
	LastCheckIn       string             `json:"last_check_in,omitempty"`
	LastCheckOut      string             `json:"last_check_out,omitempty"`
	HoursToday        float64            `json:"hours_today"`
	RecentAttendances []AttendanceRecord `json:"recent_attendances,omitempty"`
	ErrorMessage      string             `json:"error_message,omitempty"`
	ServerURL         string             `json:"server_url"`
}

func (c *Client) post(ctx context.Context, endpoint string, payload interface{}, out interface{}) error {
	if c.BaseURL == "" || c.APIKey == "" {
		return errors.New("odoo: base URL and API key are required")
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	url := c.BaseURL + endpoint
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Authorization", "bearer "+c.APIKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("do request %s: %w", endpoint, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response body: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("odoo api error (%d): %s", resp.StatusCode, string(body))
	}

	if out != nil {
		if err := json.Unmarshal(body, out); err != nil {
			return fmt.Errorf("unmarshal response: %w", err)
		}
	}

	return nil
}

// GetUID gets the current user's UID via res.users/context_get.
func (c *Client) GetUID(ctx context.Context) (int, error) {
	var ctxResp ContextResponse
	if err := c.post(ctx, "/json/2/res.users/context_get", map[string]interface{}{}, &ctxResp); err != nil {
		return 0, err
	}
	if ctxResp.UID <= 0 {
		return 0, fmt.Errorf("odoo: invalid UID received: %d", ctxResp.UID)
	}
	return ctxResp.UID, nil
}

// GetEmployee retrieves the hr.employee linked to the given user ID.
func (c *Client) GetEmployee(ctx context.Context, uid int) (*Employee, error) {
	req := map[string]interface{}{
		"domain": [][]interface{}{
			{"user_id", "=", uid},
		},
		"fields": []string{
			"id",
			"name",
			"attendance_state",
			"last_check_in",
			"last_check_out",
			"hours_today",
			"total_overtime",
		},
		"limit": 1,
	}

	log.Println("Calling api call to get user data")
	var employees []Employee
	if err := c.post(ctx, "/json/2/hr.employee/search_read", req, &employees); err != nil {
		return nil, err
	}

	if len(employees) == 0 {
		return nil, ErrNoEmployeeLinked
	}

	return &employees[0], nil
}

// GetEmployeeByID retrieves the hr.employee by its employee ID (1 request).
func (c *Client) GetEmployeeByID(ctx context.Context, empID int) (*Employee, error) {
	req := map[string]interface{}{
		"domain": [][]interface{}{
			{"id", "=", empID},
		},
		"fields": []string{
			"id",
			"name",
			"attendance_state",
			"last_check_in",
			"last_check_out",
			"hours_today",
			"total_overtime",
		},
		"limit": 1,
	}

	log.Println("Calling api call to get employee data")
	var employees []Employee
	if err := c.post(ctx, "/json/2/hr.employee/search_read", req, &employees); err != nil {
		return nil, err
	}

	if len(employees) == 0 {
		return nil, ErrNoEmployeeLinked
	}

	return &employees[0], nil
}

func (c *Client) FetchStatus(ctx context.Context) (*OdooStatus, error) {
	status := &OdooStatus{
		Connected: false,
		ServerURL: c.BaseURL,
	}

	var emp *Employee
	var uid int = c.UserID

	// 1. If we have a cached EmployeeID, fetch directly (1 request)
	if c.EmployeeID > 0 {
		var err error
		emp, err = c.GetEmployeeByID(ctx, c.EmployeeID)
		if err != nil {
			// If cached lookup fails, fallback to full resolution
			emp = nil
		}
	}

	// 2. Fallback: resolve UID via context_get and then employee via search_read
	if emp == nil {
		var err error
		uid, err = c.GetUID(ctx)
		if err != nil {
			status.ErrorMessage = err.Error()
			return status, err
		}
		c.UserID = uid

		emp, err = c.GetEmployee(ctx, uid)
		if err != nil {
			status.ErrorMessage = err.Error()
			return status, err
		}
		c.EmployeeID = emp.ID
	}

	status.Connected = true
	status.UserID = uid
	status.EmployeeName = emp.Name
	status.EmployeeID = emp.ID
	status.AttendanceState = emp.AttendanceState
	status.HoursToday = emp.HoursToday

	if s, ok := emp.LastCheckIn.(string); ok && s != "" {
		status.LastCheckIn = s
	}
	if s, ok := emp.LastCheckOut.(string); ok && s != "" {
		status.LastCheckOut = s
	}

	return status, nil
}

// // GetRecentAttendances retrieves the recent attendance logs for the employee.
// func (c *Client) GetRecentAttendances(ctx context.Context, empID int, limit int) ([]AttendanceRecord, error) {
// 	if limit <= 0 {
// 		limit = 10
// 	}
// 	req := map[string]interface{}{
// 		"domain": [][]interface{}{
// 			{"employee_id", "=", empID},
// 		},
// 		"fields": []string{
// 			"id",
// 			"check_in",
// 			"check_out",
// 			"worked_hours",
// 		},
// 		"order": "check_in desc",
// 		"limit": limit,
// 	}

// 	var records []AttendanceRecord
// 	if err := c.post(ctx, "/json/2/hr.attendance/search_read", req, &records); err != nil {
// 		return nil, err
// 	}
// 	return records, nil
// }
