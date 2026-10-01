package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime/debug"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"odoo-attendance-app/internal/attendance"
	"odoo-attendance-app/internal/launcher"
	"odoo-attendance-app/internal/lifecycle"
	"odoo-attendance-app/internal/notification"
	"odoo-attendance-app/internal/odoo"
	"odoo-attendance-app/internal/schedule"
	"odoo-attendance-app/internal/storage"
)

const settingsFile = "settings.json"

var (
	// Version of the application.
	Version = "1.0.0"
	// BuildTime injected at compile-time via ldflags: -X 'main.BuildTime=...'
	BuildTime = ""
	appStart  = time.Now()
)

// AppInfo contains metadata for frontend display.
type AppInfo struct {
	Version   string `json:"version"`
	BuildTime string `json:"build_time"`
}

// CheckResult is returned from CheckIn / CheckOut to the frontend.
type CheckResult struct {
	OK      bool   `json:"ok"`
	Message string `json:"message,omitempty"`
}

// windowEmitter wraps Wails v3 WebviewWindows for the EventEmitter interface.
type windowEmitter struct {
	mu   sync.RWMutex
	wins []*application.WebviewWindow
}

func (e *windowEmitter) SetWindows(wins ...*application.WebviewWindow) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.wins = nil
	for _, w := range wins {
		if w != nil {
			e.wins = append(e.wins, w)
		}
	}
}

func (e *windowEmitter) SetWindow(w *application.WebviewWindow) {
	e.SetWindows(w)
}

func (e *windowEmitter) Emit(name string, data ...interface{}) {
	e.mu.RLock()
	wins := make([]*application.WebviewWindow, len(e.wins))
	copy(wins, e.wins)
	e.mu.RUnlock()

	for _, w := range wins {
		if w != nil {
			if len(data) == 0 {
				w.EmitEvent(name)
			} else {
				w.EmitEvent(name, data...)
			}
		}
	}
}

// AppService is the Wails v3 service bound to the frontend.
// It implements the full API surface and wires all internal packages.
type AppService struct {
	mainWindow     *application.WebviewWindow
	checkoutWindow *application.WebviewWindow
	emitter        *windowEmitter
	store          *storage.FileStore
	settings       schedule.Settings
	attendance     *attendance.Manager
	lifecycle      *lifecycle.LinuxLifecycleManager
	urlLauncher    launcher.URLLauncher
	wailsApp       *application.App
	odooClient     *odoo.Client
	notifier       notification.Notifier

	reminderCancel context.CancelFunc

	odooSyncPending bool
	lastOdooStatus  *odoo.OdooStatus

	mu sync.Mutex
}

// NewAppService creates the AppService. Dependencies are created in Startup.
func NewAppService() *AppService {
	return &AppService{
		emitter: &windowEmitter{},
	}
}

// SetWindows configures the references to the main app window and the checkout dialog window.
func (a *AppService) SetWindows(mainWin, checkoutWin *application.WebviewWindow) {
	a.mainWindow = mainWin
	a.checkoutWindow = checkoutWin
	a.emitter.SetWindows(mainWin, checkoutWin)
}

func (a *AppService) setWindow(w *application.WebviewWindow) {
	a.SetWindows(w, nil)
}

// Startup initialises all background services. Called before app.Run().
func (a *AppService) Startup(app *application.App) error {
	a.wailsApp = app

	// Storage
	store, err := storage.NewFileStore()
	if err != nil {
		return fmt.Errorf("storage: %w", err)
	}
	a.store = store

	// Settings
	a.loadSettings()

	// Attendance
	att, err := attendance.NewManager(store, attendance.RealClock{})
	if err != nil {
		return fmt.Errorf("attendance: %w", err)
	}
	a.attendance = att

	// URL Launcher
	a.urlLauncher = launcher.NewXDGLauncher()

	emitter := &showWindowEmitter{svc: a, delegate: a.emitter}

	// Lifecycle (login / logout / shutdown interception via D-Bus logind and session managers)
	lm := lifecycle.NewLinuxLifecycleManager(emitter)
	lm.SetCheckInPromptChecker(func() bool {
		return !a.attendance.IsCheckedIn()
	})
	lm.SetPromptChecker(func() bool {
		threshold := a.settings.GetLogThreshold()
		return a.attendance.ShouldPromptDialog(threshold)
	})
	a.lifecycle = lm

	if err := lm.Start(); err != nil {
		log.Printf("startup: lifecycle: %v (lifecycle interception may be unavailable)", err)
	}

	// Emit initial status once the windows are ready.
	go func() {
		time.Sleep(500 * time.Millisecond)
		a.emitter.Emit("status-changed", att.GetStatus())
	}()

	// Sync autostart with operating system on startup.
	if a.settings.Autostart {
		if err := app.Autostart.Enable(); err != nil {
			log.Printf("startup: autostart enable: %v", err)
		}
	}

	// Notifications
	a.notifier = notification.NewBestNotifier()

	// Initial Odoo sync in background if configured
	if a.settings.OdooSyncEnabled && a.odooClient != nil {
		go func() {
			_, _ = a.SyncOdooStatus()
		}()
	}

	// Start check-in reminder notifications if last check-in/out is not today
	a.startCheckInReminderLoop()

	return nil
}

// showWindowEmitter manages opening and closing the appropriate window for lifecycle events.
type showWindowEmitter struct {
	svc      *AppService
	delegate interface{ Emit(string, ...interface{}) }
}

func (e *showWindowEmitter) Emit(name string, data ...interface{}) {
	if name == "login-requested" {
		e.svc.ShowCheckInWindow()
		return
	} else if name == "shutdown-requested" {
		action := "shutdown"
		if len(data) > 0 {
			if m, ok := data[0].(map[string]string); ok && m["action"] != "" {
				action = m["action"]
			}
		}
		e.svc.ShowCheckOutWindow(action)
		return
	} else if name == "login-dialog-closed" {
		e.svc.HideCheckInWindow()
		return
	} else if name == "shutdown-dialog-closed" {
		e.svc.HideCheckOutWindow()
		return
	}
	e.delegate.Emit(name, data...)
}

// Shutdown is called by Wails when app.Quit() is invoked.
func (a *AppService) Shutdown() {
	a.stopCheckInReminderLoop()
	if a.lifecycle != nil {
		a.lifecycle.Stop()
	}
}

func parseOdooTimestamp(val interface{}) (time.Time, bool) {
	s, ok := val.(string)
	if !ok || s == "" {
		return time.Time{}, false
	}
	t, err := time.Parse("2006-01-02 15:04:05", s)
	if err != nil {
		t, err = time.Parse(time.RFC3339, s)
		if err != nil {
			return time.Time{}, false
		}
	}
	return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), 0, time.UTC).Local(), true
}

// loadSettings reads settings from disk, applying defaults for missing fields.
func (a *AppService) loadSettings() {
	var s schedule.Settings
	err := a.store.ReadJSON(settingsFile, &s)
	if errors.Is(err, storage.ErrNotFound) {
		s = schedule.DefaultSettings()
		if werr := a.store.WriteJSON(settingsFile, s); werr != nil {
			log.Printf("loadSettings: write defaults: %v", werr)
		}
	} else if err != nil {
		log.Printf("loadSettings: %v — using defaults", err)
		s = schedule.DefaultSettings()
	}
	if s.LogThresholdMinutes < 0 {
		s.LogThresholdMinutes = 0
	}
	a.settings = s
	if s.OdooSyncEnabled && s.URL != "" && s.APIKey != "" {
		client := odoo.NewClient(s.URL, s.APIKey)
		client.SetCachedIDs(s.UserID, s.EmployeeID)
		a.odooClient = client
	} else {
		a.odooClient = nil
	}
}

// ── Wails-bound API ──────────────────────────────────────────────────────────

// GetAppInfo returns metadata including version and build timestamp.
func (a *AppService) GetAppInfo() AppInfo {
	bt := BuildTime
	if bt == "" {
		if info, ok := debug.ReadBuildInfo(); ok {
			for _, s := range info.Settings {
				if s.Key == "vcs.time" {
					bt = s.Value
					break
				}
			}
		}
	}
	if bt == "" {
		bt = appStart.Format("2006-01-02 15:04:05 MST")
	}
	return AppInfo{
		Version:   Version,
		BuildTime: bt,
	}
}

// GetSettings returns the full application settings.
func (a *AppService) GetSettings() schedule.Settings {
	return a.settings
}

// SaveSettings persists all settings and recalculates the reminder schedule.
func (a *AppService) SaveSettings(s schedule.Settings) error {
	if s.URL != "" {
		if err := launcher.ValidateURL(s.URL); err != nil {
			return fmt.Errorf("attendance URL: %w", err)
		}
	}
	if s.LogThresholdMinutes < 0 {
		s.LogThresholdMinutes = 0
	}

	// If APIKey or URL changed, invalidate cached IDs so fresh ones are resolved
	if s.APIKey != a.settings.APIKey || s.URL != a.settings.URL {
		s.UserID = 0
		s.EmployeeID = 0
		s.EmployeeName = ""
	} else {
		s.UserID = a.settings.UserID
		s.EmployeeID = a.settings.EmployeeID
		s.EmployeeName = a.settings.EmployeeName
	}

	if err := a.store.WriteJSON(settingsFile, s); err != nil {
		return err
	}
	a.settings = s

	if s.OdooSyncEnabled && s.URL != "" && s.APIKey != "" {
		client := odoo.NewClient(s.URL, s.APIKey)
		client.SetCachedIDs(s.UserID, s.EmployeeID)
		a.odooClient = client
		go a.SyncOdooStatus()
	} else {
		a.odooClient = nil
		a.emitter.Emit("odoo-status-changed", &odoo.OdooStatus{
			Connected: false,
		})
	}

	// Autostart — use Wails v3 built-in.
	if a.wailsApp != nil {
		if s.Autostart {
			if err := a.wailsApp.Autostart.Enable(); err != nil {
				log.Printf("autostart enable: %v", err)
			}
		} else {
			if err := a.wailsApp.Autostart.Disable(); err != nil {
				log.Printf("autostart disable: %v", err)
			}
		}
	}

	if a.lifecycle != nil {
		a.lifecycle.ArmInhibitors()
	}

	return nil
}

// GetURL returns the configured attendance URL.
func (a *AppService) GetURL() string {
	return a.settings.URL
}

// SaveURL updates only the URL portion of settings.
func (a *AppService) SaveURL(url string) error {
	return a.SaveSettings(schedule.Settings{
		URL:                 url,
		APIKey:              a.settings.APIKey,
		OdooSyncEnabled:     a.settings.OdooSyncEnabled,
		Autostart:           a.settings.Autostart,
		LogThresholdMinutes: a.settings.LogThresholdMinutes,
	})
}

// GetTodayStatus returns today's attendance status.
func (a *AppService) GetTodayStatus() attendance.DailyStatus {
	return a.attendance.GetStatus()
}

// fetches live employee attendance from Odoo and synchronizes status and logs.
// If a sync call is already pending, concurrent calls are skipped and current status is returned.
func (a *AppService) SyncOdooStatus() (*odoo.OdooStatus, error) {
	if !a.settings.OdooSyncEnabled || a.odooClient == nil || a.settings.URL == "" || a.settings.APIKey == "" {
		return nil, errors.New("odoo: live sync is disabled or credentials not configured")
	}

	a.mu.Lock()
	if a.odooSyncPending {
		cached := a.lastOdooStatus
		a.mu.Unlock()
		return cached, nil
	}
	a.odooSyncPending = true
	a.mu.Unlock()

	defer func() {
		a.mu.Lock()
		a.odooSyncPending = false
		a.mu.Unlock()
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	status, err := a.odooClient.FetchStatus(ctx)
	if err != nil {
		log.Printf("SyncOdooStatus: %v", err)
		return status, err
	}

	a.mu.Lock()
	a.lastOdooStatus = status
	a.mu.Unlock()

	// If resolved UserID/EmployeeID changed or newly discovered, cache them to settings.json
	if status.UserID != a.settings.UserID || status.EmployeeID != a.settings.EmployeeID || status.EmployeeName != a.settings.EmployeeName {
		a.settings.UserID = status.UserID
		a.settings.EmployeeID = status.EmployeeID
		a.settings.EmployeeName = status.EmployeeName
		if werr := a.store.WriteJSON(settingsFile, a.settings); werr != nil {
			log.Printf("SyncOdooStatus: cache settings: %v", werr)
		}
	}

	isCheckedIn := status.AttendanceState == "checked_in"
	_ = a.attendance.SyncFromOdoo(status.EmployeeName, status.EmployeeID, isCheckedIn, nil)
	if isCheckedIn {
		a.stopCheckInReminderLoop()
	}
	a.emitter.Emit("status-changed", a.attendance.GetStatus())
	a.emitter.Emit("odoo-status-changed", status)

	return status, nil
}

// GetOdooStatus returns the live or cached Odoo status.
func (a *AppService) GetOdooStatus() (*odoo.OdooStatus, error) {
	if !a.settings.OdooSyncEnabled {
		return &odoo.OdooStatus{Connected: false}, nil
	}
	a.mu.Lock()
	if a.odooSyncPending && a.lastOdooStatus != nil {
		cached := a.lastOdooStatus
		a.mu.Unlock()
		return cached, nil
	}
	a.mu.Unlock()
	return a.SyncOdooStatus()
}

// // GetOdooLogs retrieves the recent attendance logs from Odoo for the logs modal (1 request).
// func (a *AppService) GetOdooLogs(limit int) ([]odoo.AttendanceRecord, error) {
// 	if !a.settings.OdooSyncEnabled || a.odooClient == nil || a.settings.EmployeeID <= 0 {
// 		return nil, errors.New("odoo: live sync is not active or employee not resolved")
// 	}
// 	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
// 	defer cancel()
// 	return a.odooClient.GetRecentAttendances(ctx, a.settings.EmployeeID, limit)
// }

// TestOdooConnection tests connection with given Odoo server and API key without saving.
func (a *AppService) TestOdooConnection(odooURL, apiKey string) (*odoo.OdooStatus, error) {
	client := odoo.NewClient(odooURL, apiKey)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return client.FetchStatus(ctx)
}

// ShowWindow shows and focuses the main application window maximised.
func (a *AppService) ShowWindow() {
	if a.mainWindow == nil {
		return
	}
	a.mainWindow.Show()
	a.mainWindow.Focus()
	a.mainWindow.EmitEvent("status-changed", a.attendance.GetStatus())
}

// HideWindow hides the main application window.
func (a *AppService) HideWindow() {
	if a.mainWindow != nil {
		a.mainWindow.Hide()
	}
}

// ShowCheckInWindow displays the main window for check-in on login.
func (a *AppService) ShowCheckInWindow() {
	a.ShowWindow()
	if a.mainWindow != nil {
		a.mainWindow.EmitEvent("checkin-requested")
	}
}

// HideCheckInWindow hides the window.
func (a *AppService) HideCheckInWindow() {
	a.HideWindow()
}

// ShowCheckOutWindow displays the 2nd window (checkout/logout dialog) maximised without size flash.
func (a *AppService) ShowCheckOutWindow(action string) {
	if a.checkoutWindow != nil {
		a.checkoutWindow.Show()
		a.checkoutWindow.Focus()
		a.checkoutWindow.EmitEvent("checkout-requested", map[string]string{"action": action})
	}
}

// HideCheckOutWindow hides the 2nd window (checkout/logout dialog).
func (a *AppService) HideCheckOutWindow() {
	if a.checkoutWindow != nil {
		a.checkoutWindow.Hide()
	}
}

// HideSettingsWindow hides the window.
func (a *AppService) HideSettingsWindow() {
	a.HideWindow()
}

// CheckIn records check-in directly in Odoo (and local state) and opens configured URL.
func (a *AppService) CheckIn() CheckResult {
	a.stopCheckInReminderLoop()
	if !(a.settings.OdooSyncEnabled && a.odooClient != nil && a.settings.URL != "" && a.settings.APIKey != "") {
		if err := a.attendance.CheckIn(); err != nil {
			if errors.Is(err, attendance.ErrAlreadyCheckedIn) {
				if a.settings.URL != "" {
					_ = a.urlLauncher.Open(a.settings.URL)
				}
				a.HideWindow()
				return CheckResult{OK: true, Message: "Already checked in today."}
			}
			return CheckResult{OK: false, Message: err.Error()}
		}
	}

	a.emitter.Emit("status-changed", a.attendance.GetStatus())
	if a.lifecycle != nil {
		a.lifecycle.ArmInhibitors()
	}

	if a.settings.URL != "" {
		urlErr := a.urlLauncher.Open(a.settings.URL)
		if urlErr != nil {
			log.Printf("CheckIn: open URL: %v", urlErr)
			return CheckResult{
				OK:      true,
				Message: "Check-in recorded, but the attendance page could not be opened: " + urlErr.Error(),
			}
		}
		a.postRedirect("checked_in")
	}

	return CheckResult{OK: true}
}

func (a *AppService) postRedirect(expectedState string) {
	if !a.settings.OdooSyncEnabled {
		return
	}

	go func() {
		// Attempt 1: Check after 30 seconds
		time.Sleep(30 * time.Second)

		// Check if user has already manually synced and reached expected state
		a.mu.Lock()
		if a.lastOdooStatus != nil && (expectedState == "" || a.lastOdooStatus.AttendanceState == expectedState) {
			a.mu.Unlock()
			log.Println("postRedirect: Expected state already reached via cached/manual sync")
			return
		}
		a.mu.Unlock()

		status, _ := a.SyncOdooStatus()
		a.emitter.Emit("status-changed", a.attendance.GetStatus())

		// If status reached the expected state, finish
		if status != nil && (expectedState == "" || status.AttendanceState == expectedState) {
			log.Println("postRedirect: Status reached expected state on attempt 1")
			return
		}
		log.Println("postRedirect: Status not reached expected state on attempt 1, waiting 45s for retry")

		// Attempt 2: If not updated, wait another 45 seconds and check once more
		time.Sleep(45 * time.Second)

		// Check if user manually synced during the 45s wait
		a.mu.Lock()
		if a.lastOdooStatus != nil && (expectedState == "" || a.lastOdooStatus.AttendanceState == expectedState) {
			a.mu.Unlock()
			log.Println("postRedirect: Expected state already reached before attempt 2")
			return
		}
		a.mu.Unlock()

		_, _ = a.SyncOdooStatus()
		a.emitter.Emit("status-changed", a.attendance.GetStatus())
	}()
}

// CheckOut records check-out directly in Odoo (and local state) and opens configured URL.
func (a *AppService) CheckOut() CheckResult {
	if !(a.settings.OdooSyncEnabled && a.odooClient != nil && a.settings.URL != "" && a.settings.APIKey != "") {
		if err := a.attendance.CheckOut(); err != nil {
			if errors.Is(err, attendance.ErrAlreadyCheckedOut) || errors.Is(err, attendance.ErrNotCheckedIn) {
				_ = a.attendance.ForceCheckOut()
				a.emitter.Emit("status-changed", a.attendance.GetStatus())
				if a.settings.URL != "" {
					_ = a.urlLauncher.Open(a.settings.URL)
				}
				return CheckResult{OK: true}
			}
			return CheckResult{OK: false, Message: err.Error()}
		}
	}

	a.emitter.Emit("status-changed", a.attendance.GetStatus())

	if a.settings.URL != "" {
		urlErr := a.urlLauncher.Open(a.settings.URL)
		if urlErr != nil {
			log.Printf("CheckOut: open URL: %v", urlErr)
			return CheckResult{
				OK:      true,
				Message: "Check-out recorded, but the attendance page could not be opened: " + urlErr.Error(),
			}
		}
		a.postRedirect("checked_out")
	}
	return CheckResult{OK: true}
}

// LoginCheckIn is called from the login check-in reminder dialog.
func (a *AppService) LoginCheckIn() CheckResult {
	res := a.CheckIn()
	if a.lifecycle != nil {
		a.lifecycle.UserLoginCheckIn()
	}
	a.HideCheckInWindow()
	return res
}

// LoginContinue is called from the login reminder dialog's Skip / Continue button.
func (a *AppService) LoginContinue() {
	if a.lifecycle != nil {
		a.lifecycle.UserLoginContinue()
	}
	a.HideCheckInWindow()
}

// AbortAction cancels any pending shutdown/logout via "shutdown -c" and hides the checkout window, keeping the system ON.
func (a *AppService) AbortAction() {
	if a.lifecycle != nil {
		a.lifecycle.AbortAction()
	}
	a.HideCheckOutWindow()
}

// ProceedAction releases inhibitor locks and executes system poweroff/shutdown.
func (a *AppService) ProceedAction() {
	if a.lifecycle != nil {
		a.lifecycle.ProceedAction()
	}
	a.HideCheckOutWindow()
}

// ShutdownCheckOut is called from the shutdown/logout dialog's Check Out button.
// It records checkout, launches attendance URL, aborts shutdown (shutdown -c), and keeps system ON.
func (a *AppService) ShutdownCheckOut() CheckResult {
	res := a.CheckOut()
	a.AbortAction()
	return res
}

// ShutdownContinue is called from the shutdown dialog's Continue button.
// It allows shutdown to proceed by calling ProceedAction (releases lock / calls systemctl poweroff).
func (a *AppService) ShutdownContinue() {
	a.ProceedAction()
}

// ShutdownCancel is called when the user cancels the shutdown/logout dialog.
// It aborts the logout/shutdown sequence (shutdown -c) and hides the window.
func (a *AppService) ShutdownCancel() {
	a.AbortAction()
}

// CancelIfCheckingOut handles the window being closed while in checkout reminder.
// If window is closed, abort the action (user decision: cancel).
func (a *AppService) CancelIfCheckingOut() {
	if a.lifecycle != nil && a.lifecycle.GetState() == lifecycle.StateCheckingOut {
		a.AbortAction()
	}
}

// ShutdownSkip tells the extension to proceed with the original action or dismisses reminder.
func (a *AppService) ShutdownSkip() {
	a.ProceedAction()
}

// GetAutostartEnabled returns whether autostart is currently configured.
func (a *AppService) GetAutostartEnabled() bool {
	if a.wailsApp == nil {
		return false
	}
	enabled, err := a.wailsApp.Autostart.IsEnabled()
	if err != nil {
		log.Printf("autostart IsEnabled: %v", err)
		return false
	}
	return enabled
}

// GetAppExecutablePath returns the path to the running binary (for manual
// systemd service setup).
func (a *AppService) GetAppExecutablePath() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	resolved, err := filepath.EvalSymlinks(exe)
	if err != nil {
		return exe
	}
	return resolved
}

// startCheckInReminderLoop starts a background loop that sends a check-in reminder
// notification every 5 minutes up to 6 times if the user has not checked in or recorded activity today.
func (a *AppService) startCheckInReminderLoop() {
	a.mu.Lock()
	if a.reminderCancel != nil {
		a.reminderCancel()
		a.reminderCancel = nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	a.reminderCancel = cancel
	a.mu.Unlock()

	go func() {
		// Allow startup and initial sync to finish before checking
		select {
		case <-ctx.Done():
			return
		case <-time.After(3 * time.Second):
		}

		if a.attendance == nil || a.attendance.IsCheckedIn() || a.attendance.HasActivityToday() {
			return
		}

		const maxCount = 6
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()

		for count := 0; count < maxCount; count++ {
			if a.attendance == nil || a.attendance.IsCheckedIn() || a.attendance.HasActivityToday() {
				return
			}

			if a.notifier != nil {
				if err := a.notifier.Notify("Check-in Reminder", "You haven't checked in today. Please remember to record your attendance."); err != nil {
					log.Printf("reminder notification (%d/%d): %v", count+1, maxCount, err)
				} else {
					log.Printf("reminder notification sent (%d/%d)", count+1, maxCount)
				}
			}

			if count < maxCount-1 {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
				}
			}
		}
	}()
}

// stopCheckInReminderLoop stops any running check-in reminder notification loop.
func (a *AppService) stopCheckInReminderLoop() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.reminderCancel != nil {
		a.reminderCancel()
		a.reminderCancel = nil
	}
}
