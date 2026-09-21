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
	"time-check/internal/notification"
	"time-check/internal/schedule"
	"time-check/internal/scheduler"
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
	checkinWin  *application.WebviewWindow
	checkoutWin *application.WebviewWindow
	settingsWin *application.WebviewWindow
	emitter     *windowEmitter
	store       *storage.FileStore
	settings    schedule.Settings
	attendance  *attendance.Manager
	sched       *scheduler.Scheduler
	lifecycle   *lifecycle.LinuxLifecycleManager
	urlLauncher launcher.URLLauncher
	wailsApp    *application.App

	checkInSnoozeTimer  *time.Timer
	checkOutSnoozeTimer *time.Timer

	mu sync.Mutex
}

// NewAppService creates the AppService. Dependencies are created in Startup.
func NewAppService() *AppService {
	return &AppService{
		emitter: &windowEmitter{},
	}
}

// SetWindows configures references to the check-in, check-out, and settings windows.
func (a *AppService) SetWindows(checkin, checkout, settings *application.WebviewWindow) {
	a.checkinWin = checkin
	a.checkoutWin = checkout
	a.settingsWin = settings
	a.emitter.SetWindows(checkin, checkout, settings)
}

// SetWindow gives the service a reference to a window (compatibility helper).
func (a *AppService) SetWindow(w *application.WebviewWindow) {
	a.SetWindows(w, nil, nil)
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

	// Notifier
	notifier := notification.NewBestNotifier()

	// Scheduler
	realTimer := scheduler.RealTimer{}
	emitter := &showWindowEmitter{svc: a, delegate: a.emitter}
	s := scheduler.NewScheduler(
		scheduler.RealClock{},
		realTimer,
		notifier,
		emitter,
		att,
		store,
	)
	a.sched = s
	if a.settings.SchedulerEnabled {
		s.Start(a.settings.Schedule)
	}

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
	if a.sched != nil {
		a.sched.Stop()
	}
	if a.lifecycle != nil {
		a.lifecycle.Stop()
	}
	a.mu.Lock()
	if a.checkInSnoozeTimer != nil {
		a.checkInSnoozeTimer.Stop()
		a.checkInSnoozeTimer = nil
	}
	if a.checkOutSnoozeTimer != nil {
		a.checkOutSnoozeTimer.Stop()
		a.checkOutSnoozeTimer = nil
	}
	a.mu.Unlock()
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
	if s.CheckOutWindowBeforeMinutes < 0 {
		s.CheckOutWindowBeforeMinutes = 0
	}
	if s.CheckOutWindowAfterMinutes <= 0 {
		s.CheckOutWindowAfterMinutes = 30
	}
	if s.SnoozeDurationMinutes <= 0 {
		s.SnoozeDurationMinutes = 10
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
	if err := s.Schedule.Validate(); err != nil {
		return fmt.Errorf("invalid schedule: %w", err)
	}
	if s.URL != "" {
		if err := launcher.ValidateURL(s.URL); err != nil {
			return fmt.Errorf("attendance URL: %w", err)
		}
	}
	if s.LogThresholdMinutes <= 0 {
		s.LogThresholdMinutes = 3
	}
	if s.CheckOutWindowBeforeMinutes < 0 {
		s.CheckOutWindowBeforeMinutes = 0
	}
	if s.CheckOutWindowAfterMinutes <= 0 {
		s.CheckOutWindowAfterMinutes = 30
	}
	if s.SnoozeDurationMinutes <= 0 {
		s.SnoozeDurationMinutes = 10
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

	// Recalculate scheduler.
	if s.SchedulerEnabled {
		a.sched.UpdateSchedule(s.Schedule)
	} else {
		a.sched.Stop()
	}
	if a.lifecycle != nil {
		a.lifecycle.ArmInhibitors()
	}
	a.emitter.Emit("schedule-changed", s.Schedule)
	return nil
}


// GetSchedule returns the current schedule.
func (a *AppService) GetSchedule() schedule.Schedule {
	return a.settings.Schedule
}

// SaveSchedule updates only the schedule portion of settings.
func (a *AppService) SaveSchedule(s schedule.Schedule) error {
	return a.SaveSettings(schedule.Settings{
		Schedule:  s,
		URL:       a.settings.URL,
		Autostart: a.settings.Autostart,
	})
}

// GetURL returns the configured attendance URL.
func (a *AppService) GetURL() string {
	return a.settings.URL
}

// SaveURL updates only the URL portion of settings.
func (a *AppService) SaveURL(url string) error {
	return a.SaveSettings(schedule.Settings{
		Schedule:  a.settings.Schedule,
		URL:       url,
		Autostart: a.settings.Autostart,
	})
}

// GetTodayStatus returns today's attendance status.
func (a *AppService) GetTodayStatus() attendance.DailyStatus {
	return a.attendance.GetStatus()
}

// ShowCheckInWindow displays the check-in dialog window.
func (a *AppService) ShowCheckInWindow() {
	if a.checkinWin != nil {
		a.checkinWin.SetSize(420, 260)
		a.checkinWin.Center()
		a.checkinWin.SetAlwaysOnTop(true)
		a.checkinWin.Show()
		a.checkinWin.UnMinimise()
		a.checkinWin.Restore()
		a.checkinWin.Focus()
		a.checkinWin.EmitEvent("checkin-requested")
	}
}

// HideCheckInWindow hides the check-in window.
func (a *AppService) HideCheckInWindow() {
	if a.checkinWin != nil {
		a.checkinWin.SetAlwaysOnTop(false)
		a.checkinWin.Hide()
	}
}

// ShowCheckOutWindow displays the check-out dialog window.
func (a *AppService) ShowCheckOutWindow(action string) {
	if a.checkoutWin != nil {
		a.checkoutWin.SetSize(420, 260)
		a.checkoutWin.Center()
		a.checkoutWin.SetAlwaysOnTop(true)
		a.checkoutWin.Show()
		a.checkoutWin.UnMinimise()
		a.checkoutWin.Restore()
		a.checkoutWin.Focus()
		a.checkoutWin.EmitEvent("checkout-requested", map[string]string{"action": action})
	}
}

// HideCheckOutWindow hides the check-out window.
func (a *AppService) HideCheckOutWindow() {
	if a.checkoutWin != nil {
		a.checkoutWin.SetAlwaysOnTop(false)
		a.checkoutWin.Hide()
	}
}

// ShowSettingsWindow displays the settings and attendance dashboard window.
func (a *AppService) ShowSettingsWindow() {
	if a.settingsWin != nil {
		a.settingsWin.SetSize(480, 680)
		a.settingsWin.Show()
		a.settingsWin.UnMinimise()
		a.settingsWin.Restore()
		a.settingsWin.Focus()
		a.settingsWin.EmitEvent("status-changed", a.attendance.GetStatus())
	}
}

// HideSettingsWindow hides the settings window.
func (a *AppService) HideSettingsWindow() {
	if a.settingsWin != nil {
		a.settingsWin.Hide()
	}
}

// ShowWindow shows and focuses the main/settings application window.
func (a *AppService) ShowWindow() {
	a.ShowSettingsWindow()
}

// HideWindow hides the settings application window.
func (a *AppService) HideWindow() {
	a.HideSettingsWindow()
}

// CheckIn records check-in and opens the configured URL.
func (a *AppService) CheckIn() CheckResult {
	a.mu.Lock()
	if a.checkInSnoozeTimer != nil {
		a.checkInSnoozeTimer.Stop()
		a.checkInSnoozeTimer = nil
	}
	a.mu.Unlock()

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
	a.mu.Lock()
	if a.checkOutSnoozeTimer != nil {
		a.checkOutSnoozeTimer.Stop()
		a.checkOutSnoozeTimer = nil
	}
	a.mu.Unlock()

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

// GetNextReminder returns the next scheduled reminder, or nil if none or if scheduler is disabled.
func (a *AppService) GetNextReminder() *scheduler.NextReminder {
	if !a.settings.SchedulerEnabled {
		return nil
	}
	return a.sched.GetNextReminder()
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

// LoginContinue is called from the login reminder dialog's Skip button.
func (a *AppService) LoginContinue() {
	a.mu.Lock()
	if a.checkInSnoozeTimer != nil {
		a.checkInSnoozeTimer.Stop()
		a.checkInSnoozeTimer = nil
	}
	a.mu.Unlock()

	if a.lifecycle != nil {
		a.lifecycle.UserLoginContinue()
	}
	a.HideCheckInWindow()
}

// SnoozeCheckIn snoozes the check-in reminder for the configured snooze duration.
func (a *AppService) SnoozeCheckIn() {
	if a.lifecycle != nil {
		a.lifecycle.UserLoginContinue()
	}
	a.HideCheckInWindow()

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.checkInSnoozeTimer != nil {
		a.checkInSnoozeTimer.Stop()
	}
	snoozeDuration := a.settings.GetSnoozeDuration()
	a.checkInSnoozeTimer = time.AfterFunc(snoozeDuration, func() {
		if a.attendance != nil && !a.attendance.IsCheckedIn() {
			a.ShowCheckInWindow()
			a.emitter.Emit("reminder-triggered", map[string]string{"type": "check_in"})
		}
	})
}

// SnoozeCheckOut snoozes the check-out reminder for the configured snooze duration.
// If triggered from logout/poweroff interception, it cancels the shutdown to keep the system active.
func (a *AppService) SnoozeCheckOut() {
	if a.lifecycle != nil {
		a.lifecycle.AbortAction()
	}
	a.HideCheckOutWindow()

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.checkOutSnoozeTimer != nil {
		a.checkOutSnoozeTimer.Stop()
	}
	snoozeDuration := a.settings.GetSnoozeDuration()
	a.checkOutSnoozeTimer = time.AfterFunc(snoozeDuration, func() {
		if a.attendance != nil && !a.attendance.IsCheckedOut() {
			a.ShowCheckOutWindow("reminder")
			a.emitter.Emit("reminder-triggered", map[string]string{"type": "check_out"})
		}
	})
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
	a.mu.Lock()
	if a.checkOutSnoozeTimer != nil {
		a.checkOutSnoozeTimer.Stop()
		a.checkOutSnoozeTimer = nil
	}
	a.mu.Unlock()

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
