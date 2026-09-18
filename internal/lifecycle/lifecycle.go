// Package lifecycle manages the application shutdown state machine and
// Linux session lifecycle interception via systemd-logind D-Bus and session managers.
package lifecycle

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



