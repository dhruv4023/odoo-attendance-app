package main

import (
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime/debug"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"time-check/internal/attendance"
	"time-check/internal/launcher"
	"time-check/internal/lifecycle"
	"time-check/internal/schedule"
	"time-check/internal/storage"
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
	mainWindow  *application.WebviewWindow
	emitter     *windowEmitter
	store       *storage.FileStore
	settings    schedule.Settings
	attendance  *attendance.Manager
	lifecycle   *lifecycle.LinuxLifecycleManager
	urlLauncher launcher.URLLauncher
	wailsApp    *application.App

	mu sync.Mutex
}

// NewAppService creates the AppService. Dependencies are created in Startup.
func NewAppService() *AppService {
	return &AppService{
		emitter: &windowEmitter{},
	}
}

// setWindow configures the reference to the single main window.
func (a *AppService) setWindow(w *application.WebviewWindow) {
	a.mainWindow = w
	a.emitter.SetWindows(w)
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
		// Only prompt check-in dialog on login if the user has not checked in today.
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

	// Midnight reset loop in background (for 24/7 always-on machines).
	go a.midnightResetLoop()

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
	} else if name == "shutdown-requested" {
		action := "shutdown"
		if len(data) > 0 {
			if m, ok := data[0].(map[string]string); ok && m["action"] != "" {
				action = m["action"]
			}
		}
		e.svc.ShowCheckOutWindow(action)
	} else if name == "reminder-triggered" {
		if len(data) > 0 {
			if m, ok := data[0].(map[string]string); ok {
				if m["type"] == "check_in" {
					e.svc.ShowCheckInWindow()
				} else if m["type"] == "check_out" {
					e.svc.ShowCheckOutWindow("reminder")
				}
			}
		}
	} else if name == "login-dialog-closed" {
		e.svc.HideCheckInWindow()
	} else if name == "shutdown-dialog-closed" {
		e.svc.HideCheckOutWindow()
	}
	e.delegate.Emit(name, data...)
}


// Shutdown is called by Wails when app.Quit() is invoked.
func (a *AppService) Shutdown() {
	if a.lifecycle != nil {
		a.lifecycle.Stop()
	}
}

// midnightResetLoop sleeps until midnight to roll over the day and notify the UI (for 24/7 always-on machines).
func (a *AppService) midnightResetLoop() {
	for {
		now := time.Now()
		nextMidnight := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 1, 0, now.Location())
		sleepDuration := time.Until(nextMidnight)
		if sleepDuration <= 0 {
			sleepDuration = time.Second
		}

		time.Sleep(sleepDuration)

		if err := a.attendance.ResetIfNewDay(); err != nil {
			log.Printf("midnightReset: %v", err)
		}
		if a.lifecycle != nil {
			a.lifecycle.ResetLoginReminder()
			a.lifecycle.ArmInhibitors()
		}
		a.emitter.Emit("status-changed", a.attendance.GetStatus())
	}
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
	if s.LogThresholdMinutes <= 0 {
		s.LogThresholdMinutes = 3
	}
	a.settings = s
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
	if s.LogThresholdMinutes <= 0 {
		s.LogThresholdMinutes = 3
	}
	if err := a.store.WriteJSON(settingsFile, s); err != nil {
		return err
	}
	a.settings = s

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
		URL:       url,
		Autostart: a.settings.Autostart,
	})
}

// GetTodayStatus returns today's attendance status.
func (a *AppService) GetTodayStatus() attendance.DailyStatus {
	return a.attendance.GetStatus()
}

// ShowWindow shows and focuses the main application window in fullscreen.
func (a *AppService) ShowWindow() {
	if a.mainWindow != nil {
		a.mainWindow.Show()
		a.mainWindow.UnMinimise()
		a.mainWindow.Fullscreen()
		a.mainWindow.Focus()
		a.mainWindow.EmitEvent("status-changed", a.attendance.GetStatus())
	}
}

// HideWindow hides the main application window.
func (a *AppService) HideWindow() {
	if a.mainWindow != nil {
		a.mainWindow.SetAlwaysOnTop(false)
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

// ShowCheckOutWindow displays the checkout prompt in the main window.
func (a *AppService) ShowCheckOutWindow(action string) {
	a.ShowWindow()
	if a.mainWindow != nil {
		a.mainWindow.EmitEvent("checkout-requested", map[string]string{"action": action})
	}
}

// HideCheckOutWindow hides the window.
func (a *AppService) HideCheckOutWindow() {
	a.HideWindow()
}

// ShowSettingsWindow displays the main window with settings view active.
func (a *AppService) ShowSettingsWindow() {
	a.ShowWindow()
	if a.mainWindow != nil {
		a.mainWindow.EmitEvent("open-settings")
	}
}

// HideSettingsWindow hides the window.
func (a *AppService) HideSettingsWindow() {
	a.HideWindow()
}

// CheckIn records check-in and opens the configured URL.
func (a *AppService) CheckIn() CheckResult {


	if err := a.attendance.CheckIn(); err != nil {
		if errors.Is(err, attendance.ErrAlreadyCheckedIn) {
			// Already checked in — still open attendance URL if configured
			if a.settings.URL != "" {
				_ = a.urlLauncher.Open(a.settings.URL)
			}
			return CheckResult{OK: true, Message: "Already checked in today."}
		}
		return CheckResult{OK: false, Message: err.Error()}
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
	}
	return CheckResult{OK: true}
}

// CheckOut records check-out and opens the configured URL.
func (a *AppService) CheckOut() CheckResult {
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
