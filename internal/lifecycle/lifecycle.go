// Package lifecycle manages the application shutdown state machine and
// Linux session lifecycle interception via systemd-logind D-Bus and session managers.
package lifecycle

import "strings"

// State represents the current lifecycle state.
type State int

const (
	// StateRunning is the normal operational state.
	StateRunning State = iota
	// StateCheckingIn means a login event occurred and we're prompting for check-in.
	StateCheckingIn
	// StateCheckingOut means a shutdown/logout was requested and we're waiting for user action.
	StateCheckingOut
	// StateAllowExit means the user has responded and the shutdown/exit may proceed.
	StateAllowExit
)

// ActionType identifies the system lifecycle action.
type ActionType string

const (
	ActionLogin    ActionType = "login"
	ActionLogout   ActionType = "logout"
	ActionShutdown ActionType = "shutdown"
	ActionReboot   ActionType = "reboot"
)

// PromptChecker returns whether the reminder dialog should be prompted (e.g. no recent log recorded within threshold).
type PromptChecker func() bool

// EventEmitter emits Wails frontend events (injected to avoid import cycle).
type EventEmitter interface {
	Emit(name string, data ...interface{})
}

// ValidateAction validates and normalizes an action string received from D-Bus or UI.
// Only "logout", "shutdown" (or "power-off"), and "reboot" (or "restart") are supported.
func ValidateAction(raw string) (ActionType, bool) {
	if strings.ContainsAny(raw, "\r\n\t\x00") {
		return "", false
	}
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "logout":
		return ActionLogout, true
	case "shutdown", "power-off", "poweroff":
		return ActionShutdown, true
	case "reboot", "restart":
		return ActionReboot, true
	default:
		return "", false
	}
}
