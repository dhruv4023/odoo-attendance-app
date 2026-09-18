package lifecycle

import (
	"log"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/godbus/dbus/v5"
)

const (
	DBusBusName       = "com.odoo.TimeCheck"
	DBusObjectPath    = "/com/odoo/TimeCheck"
	DBusInterfaceName = "com.odoo.TimeCheck"
)

// LinuxLifecycleManager manages Linux desktop session lifecycle interception.
// It intercepts GNOME Shell logout, power off, and restart actions via a local D-Bus interface
// before GNOME starts the end-session flow.
type LinuxLifecycleManager struct {
	emitter       EventEmitter
	promptChecker PromptChecker

	mu                sync.Mutex
	state             State
	lastAction        ActionType
	loginHandled      bool
	sessionConn       *dbus.Conn
	pendingDecisionCh chan string
	done              chan struct{}
	sigChan           chan os.Signal
}

// NewLinuxLifecycleManager creates a new LinuxLifecycleManager.
func NewLinuxLifecycleManager(emitter EventEmitter) *LinuxLifecycleManager {
	return &LinuxLifecycleManager{
		emitter: emitter,
		state:   StateRunning,
		done:    make(chan struct{}),
	}
}

// SetPromptChecker sets a callback that returns true if a reminder dialog should be prompted.
func (m *LinuxLifecycleManager) SetPromptChecker(fn PromptChecker) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.promptChecker = fn
}

func (m *LinuxLifecycleManager) shouldPromptCheckOutLocked() bool {
	if m.promptChecker != nil {
		return m.promptChecker()
	}
	return false
}

func (m *LinuxLifecycleManager) shouldPromptCheckInLocked() bool {
	if m.promptChecker != nil {
		return m.promptChecker()
	}
	return true
}

// Start installs the GNOME extension, registers the D-Bus service, and performs initial login check.
func (m *LinuxLifecycleManager) Start() error {
	// 1. Install and enable the GNOME Shell extension
	if err := InstallAndEnableExtension(); err != nil {
		log.Printf("lifecycle: extension install/enable: %v", err)
	}

	// 2. Register D-Bus service on Session Bus
	sessConn, err := dbus.ConnectSessionBus()
	if err != nil {
		log.Printf("lifecycle: connect session bus: %v", err)
	} else {
		m.sessionConn = sessConn
		if err := sessConn.Export(m, DBusObjectPath, DBusInterfaceName); err != nil {
			log.Printf("lifecycle: dbus export: %v", err)
		}
		reply, err := sessConn.RequestName(DBusBusName, dbus.NameFlagDoNotQueue)
		if err != nil || reply != dbus.RequestNameReplyPrimaryOwner {
			log.Printf("lifecycle: dbus request name %s reply: %v (err: %v)", DBusBusName, reply, err)
		} else {
			log.Printf("lifecycle: registered D-Bus service %s at %s", DBusBusName, DBusObjectPath)
		}
	}

	// 3. Process Signals for graceful termination
	m.sigChan = make(chan os.Signal, 2)
	signal.Notify(m.sigChan, syscall.SIGTERM, syscall.SIGHUP, syscall.SIGINT)
	go m.listenSignals()

	// 4. Initial check for login reminder upon session start
	go func() {
		time.Sleep(500 * time.Millisecond)
		m.CheckLoginReminder()
	}()

	return nil
}

// Stop shuts down the lifecycle manager.
func (m *LinuxLifecycleManager) Stop() {
	m.mu.Lock()
	select {
	case <-m.done:
		m.mu.Unlock()
		return
	default:
		close(m.done)
	}

	if m.sigChan != nil {
		signal.Stop(m.sigChan)
	}

	// Resolve any pending request
	if m.pendingDecisionCh != nil {
		select {
		case m.pendingDecisionCh <- "cancel":
		default:
		}
		m.pendingDecisionCh = nil
	}

	if m.sessionConn != nil {
		_ = m.sessionConn.Close()
		m.sessionConn = nil
	}
	m.mu.Unlock()
}

// listenSignals handles OS process signals.
func (m *LinuxLifecycleManager) listenSignals() {
	for {
		select {
		case <-m.done:
			return
		case sig, ok := <-m.sigChan:
			if !ok {
				return
			}
			log.Printf("lifecycle: received OS signal: %v", sig)
			m.Stop()
			return
		}
	}
}

// RequestAction is the exported D-Bus method called by the GNOME Shell extension
// when the user clicks Logout, Power Off, or Restart in GNOME Shell.
// Returns "proceed" ONLY if user clicks Skip, or "cancel" for all other cases.
func (m *LinuxLifecycleManager) RequestAction(action string) (string, *dbus.Error) {
	log.Printf("lifecycle: intercepted GNOME Shell action: %s", action)

	m.mu.Lock()
	act := ActionType(action)
	if act == "" {
		act = ActionShutdown
	}
	m.lastAction = act

	// Check if attendance checkout is required
	if !m.shouldPromptCheckOutLocked() {
		log.Printf("lifecycle: no active attendance session requiring checkout; proceeding with %s", action)
		m.state = StateRunning
		m.mu.Unlock()
		return "proceed", nil
	}

	// Cancel any existing pending channel if one was open
	if m.pendingDecisionCh != nil {
		select {
		case m.pendingDecisionCh <- "cancel":
		default:
		}
	}

	decisionCh := make(chan string, 1)
	m.pendingDecisionCh = decisionCh
	m.state = StateCheckingOut
	m.mu.Unlock()

	// Show Checkout reminder dialog
	m.emitter.Emit("shutdown-requested", map[string]string{
		"action": string(act),
	})

	// Wait for user decision or safety timeout
	select {
	case decision := <-decisionCh:
		log.Printf("lifecycle: user decision for %s: %s", action, decision)
		m.mu.Lock()
		m.pendingDecisionCh = nil
		if decision == "proceed" {
			m.state = StateAllowExit
		} else {
			m.state = StateRunning
		}
		m.mu.Unlock()
		return decision, nil

	case <-time.After(120 * time.Second):
		log.Printf("lifecycle: timeout waiting for user decision on %s; cancelling action (staying alive)", action)
		m.mu.Lock()
		m.pendingDecisionCh = nil
		m.state = StateRunning
		m.mu.Unlock()
		m.emitter.Emit("shutdown-dialog-closed", "timeout")
		return "cancel", nil

	case <-m.done:
		return "cancel", nil
	}
}

// CheckLoginReminder prompts the user with the Check In dialog on login/startup.
// Idempotent: once handled, it will not re-prompt for the same login session.
func (m *LinuxLifecycleManager) CheckLoginReminder() {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.loginHandled {
		return
	}
	if m.state != StateRunning {
		return
	}
	if !m.shouldPromptCheckInLocked() {
		return
	}

	m.state = StateCheckingIn
	m.emitter.Emit("login-requested", map[string]string{
		"action": string(ActionLogin),
	})
}

// ResetLoginReminder resets the login reminder state (e.g. on new day).
func (m *LinuxLifecycleManager) ResetLoginReminder() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.loginHandled = false
}

// UserLoginCheckIn is called when the user clicks Check In in the login reminder.
func (m *LinuxLifecycleManager) UserLoginCheckIn() {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.loginHandled = true
	if m.state == StateCheckingIn {
		m.state = StateRunning
	}
	m.emitter.Emit("login-dialog-closed", "checked-in")
}

// UserLoginContinue is called when the user clicks Continue in the login reminder.
func (m *LinuxLifecycleManager) UserLoginContinue() {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.loginHandled = true
	if m.state == StateCheckingIn {
		m.state = StateRunning
	}
	m.emitter.Emit("login-dialog-closed", "continue")
}

// AbortAction is called when the user checks out or cancels the checkout dialog.
// It sends "cancel" to the GNOME Shell extension, keeping the session active.
func (m *LinuxLifecycleManager) AbortAction() {
	m.mu.Lock()
	defer m.mu.Unlock()

	log.Println("lifecycle: aborting GNOME end-session action (keeping session alive)")
	m.state = StateRunning
	if m.pendingDecisionCh != nil {
		select {
		case m.pendingDecisionCh <- "cancel":
		default:
		}
		m.pendingDecisionCh = nil
	}
	m.emitter.Emit("shutdown-dialog-closed", "cancelled")
}

// ProceedAction is called when the user skips or closes the dialog with X.
// It sends "proceed" to the GNOME Shell extension to invoke the original action.
func (m *LinuxLifecycleManager) ProceedAction() {
	m.mu.Lock()
	defer m.mu.Unlock()

	log.Println("lifecycle: user chose skip; proceeding with original GNOME action")
	m.state = StateAllowExit
	if m.pendingDecisionCh != nil {
		select {
		case m.pendingDecisionCh <- "proceed":
		default:
		}
		m.pendingDecisionCh = nil
	}
	m.emitter.Emit("shutdown-dialog-closed", "continue")
}

// UserCheckedOut is called when the user checks out from the shutdown dialog.
func (m *LinuxLifecycleManager) UserCheckedOut() {
	m.AbortAction()
}

// UserCancelled is called when the user cancels the dialog.
func (m *LinuxLifecycleManager) UserCancelled() {
	m.AbortAction()
}

// UserSkipped is called when the user skips the dialog.
func (m *LinuxLifecycleManager) UserSkipped() {
	m.ProceedAction()
}

// TriggerShutdown initiates a test or programmatic shutdown interception.
func (m *LinuxLifecycleManager) TriggerShutdown(action ActionType) {
	go func() {
		_, _ = m.RequestAction(string(action))
	}()
}

// ArmInhibitors maintains compatibility with scheduler resets.
func (m *LinuxLifecycleManager) ArmInhibitors() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state == StateAllowExit {
		m.state = StateRunning
	}
}

// GetState returns the current lifecycle state.
func (m *LinuxLifecycleManager) GetState() State {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state
}

// IsSessionEnding returns true if the OS is terminating the session.
func (m *LinuxLifecycleManager) IsSessionEnding() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state == StateAllowExit
}
