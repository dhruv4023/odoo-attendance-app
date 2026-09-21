package lifecycle_test

import (
	"sync"
	"testing"
	"time"

	"time-check/internal/lifecycle"
)

// fakeEmitter records emitted events and payloads for test assertions.
type fakeEmitter struct {
	mu     sync.Mutex
	events []string
	data   []interface{}
}

func (f *fakeEmitter) Emit(name string, data ...interface{}) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = append(f.events, name)
	if len(data) > 0 {
		f.data = append(f.data, data[0])
	} else {
		f.data = append(f.data, nil)
	}
}

func (f *fakeEmitter) Events() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	cp := make([]string, len(f.events))
	copy(cp, f.events)
	return cp
}

func (f *fakeEmitter) LastData() interface{} {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.data) == 0 {
		return nil
	}
	return f.data[len(f.data)-1]
}

func (f *fakeEmitter) Clear() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = nil
	f.data = nil
}

func TestLifecycle_Login_ShowsReminderWhenNotCheckedIn(t *testing.T) {
	emitter := &fakeEmitter{}
	mgr := lifecycle.NewLinuxLifecycleManager(emitter)
	mgr.SetPromptChecker(func() bool {
		return true // no recent log -> prompt
	})

	mgr.CheckLoginReminder()

	if mgr.GetState() != lifecycle.StateCheckingIn {
		t.Errorf("expected StateCheckingIn, got %v", mgr.GetState())
	}
	evts := emitter.Events()
	if len(evts) != 1 || evts[0] != "login-requested" {
		t.Fatalf("expected [login-requested], got %v", evts)
	}

	// Calling again while in StateCheckingIn should NOT duplicate
	mgr.CheckLoginReminder()
	if len(emitter.Events()) != 1 {
		t.Errorf("expected no duplicate login-requested event, got %d", len(emitter.Events()))
	}
}

func TestLifecycle_Login_SkippedWhenAlreadyCheckedIn(t *testing.T) {
	emitter := &fakeEmitter{}
	mgr := lifecycle.NewLinuxLifecycleManager(emitter)
	mgr.SetPromptChecker(func() bool {
		return false // recent log exists -> skip
	})

	mgr.CheckLoginReminder()

	if mgr.GetState() != lifecycle.StateRunning {
		t.Errorf("expected StateRunning, got %v", mgr.GetState())
	}
	if len(emitter.Events()) != 0 {
		t.Errorf("expected no events, got %v", emitter.Events())
	}
}

func TestLifecycle_Login_DedicatedCheckInChecker(t *testing.T) {
	emitter := &fakeEmitter{}
	mgr := lifecycle.NewLinuxLifecycleManager(emitter)
	// fallback prompt checker returns false, but dedicated check-in checker returns true
	mgr.SetPromptChecker(func() bool {
		return false
	})
	mgr.SetCheckInPromptChecker(func() bool {
		return true
	})

	mgr.CheckLoginReminder()

	if mgr.GetState() != lifecycle.StateCheckingIn {
		t.Errorf("expected StateCheckingIn, got %v", mgr.GetState())
	}
	evts := emitter.Events()
	if len(evts) != 1 || evts[0] != "login-requested" {
		t.Fatalf("expected [login-requested], got %v", evts)
	}
}

func TestLifecycle_Login_UserCheckIn(t *testing.T) {
	emitter := &fakeEmitter{}
	mgr := lifecycle.NewLinuxLifecycleManager(emitter)
	mgr.SetPromptChecker(func() bool {
		return true
	})

	mgr.CheckLoginReminder()
	mgr.UserLoginCheckIn()

	if mgr.GetState() != lifecycle.StateRunning {
		t.Errorf("expected StateRunning after check-in, got %v", mgr.GetState())
	}
	evts := emitter.Events()
	if len(evts) != 2 || evts[1] != "login-dialog-closed" {
		t.Errorf("expected login-dialog-closed, got %v", evts)
	}

	// Subsequent check in same session must not re-trigger
	mgr.CheckLoginReminder()
	if len(emitter.Events()) != 2 {
		t.Errorf("expected no duplicate after user action, got %v", emitter.Events())
	}
}

func TestLifecycle_Login_UserContinue(t *testing.T) {
	emitter := &fakeEmitter{}
	mgr := lifecycle.NewLinuxLifecycleManager(emitter)
	mgr.SetPromptChecker(func() bool {
		return true
	})

	mgr.CheckLoginReminder()
	mgr.UserLoginContinue()

	if mgr.GetState() != lifecycle.StateRunning {
		t.Errorf("expected StateRunning after continue, got %v", mgr.GetState())
	}
	evts := emitter.Events()
	if len(evts) != 2 || evts[1] != "login-dialog-closed" {
		t.Errorf("expected login-dialog-closed, got %v", evts)
	}

	// Subsequent check in same session must not re-trigger
	mgr.CheckLoginReminder()
	if len(emitter.Events()) != 2 {
		t.Errorf("expected no duplicate after user continue, got %v", emitter.Events())
	}
}

func TestLifecycle_Login_ResetAllowsNewReminder(t *testing.T) {
	emitter := &fakeEmitter{}
	mgr := lifecycle.NewLinuxLifecycleManager(emitter)
	mgr.SetPromptChecker(func() bool {
		return true
	})

	mgr.CheckLoginReminder()
	mgr.UserLoginContinue()
	if len(emitter.Events()) != 2 {
		t.Fatalf("expected 2 events")
	}

	// Reset (e.g. next day)
	mgr.ResetLoginReminder()
	mgr.CheckLoginReminder()

	evts := emitter.Events()
	if len(evts) != 3 || evts[2] != "login-requested" {
		t.Errorf("expected new login-requested after reset, got %v", evts)
	}
}

func TestLifecycle_StateConstants(t *testing.T) {
	states := []lifecycle.State{
		lifecycle.StateRunning,
		lifecycle.StateCheckingIn,
		lifecycle.StateCheckingOut,
		lifecycle.StateAllowExit,
	}
	seen := map[lifecycle.State]bool{}
	for _, s := range states {
		if seen[s] {
			t.Errorf("duplicate state value: %v", s)
		}
		seen[s] = true
	}
}

func TestLifecycle_ActionTypeConstants(t *testing.T) {
	if lifecycle.ActionLogin != "login" {
		t.Errorf("unexpected ActionLogin: %s", lifecycle.ActionLogin)
	}
	if lifecycle.ActionLogout != "logout" {
		t.Errorf("unexpected ActionLogout: %s", lifecycle.ActionLogout)
	}
	if lifecycle.ActionShutdown != "shutdown" {
		t.Errorf("unexpected ActionShutdown: %s", lifecycle.ActionShutdown)
	}
	if lifecycle.ActionReboot != "reboot" {
		t.Errorf("unexpected ActionReboot: %s", lifecycle.ActionReboot)
	}
}

func TestLifecycle_RequestAction_AlreadyCheckedOut_ReturnsProceedImmediately(t *testing.T) {
	emitter := &fakeEmitter{}
	mgr := lifecycle.NewLinuxLifecycleManager(emitter)
	mgr.SetPromptChecker(func() bool {
		return false // user already checked out or no attendance today
	})

	decision, err := mgr.RequestAction("logout")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision != "proceed" {
		t.Errorf("expected decision 'proceed', got %s", decision)
	}
	if mgr.GetState() != lifecycle.StateRunning {
		t.Errorf("expected StateRunning, got %v", mgr.GetState())
	}
	if len(emitter.Events()) != 0 {
		t.Errorf("expected no events emitted, got %v", emitter.Events())
	}
}

func TestLifecycle_RequestAction_PromptCheckout_UserChecksOut(t *testing.T) {
	emitter := &fakeEmitter{}
	mgr := lifecycle.NewLinuxLifecycleManager(emitter)
	mgr.SetPromptChecker(func() bool {
		return true // checkout reminder needed
	})

	decisionCh := make(chan string, 1)
	go func() {
		decision, err := mgr.RequestAction("shutdown")
		if err != nil {
			decisionCh <- "error"
			return
		}
		decisionCh <- decision
	}()

	// Wait for state to become StateCheckingOut
	time.Sleep(50 * time.Millisecond)
	if mgr.GetState() != lifecycle.StateCheckingOut {
		t.Fatalf("expected StateCheckingOut, got %v", mgr.GetState())
	}

	evts := emitter.Events()
	if len(evts) != 1 || evts[0] != "shutdown-requested" {
		t.Fatalf("expected [shutdown-requested], got %v", evts)
	}

	// User clicks Check Out -> AbortAction / UserCheckedOut
	mgr.UserCheckedOut()

	select {
	case decision := <-decisionCh:
		if decision != "cancel" {
			t.Errorf("expected decision 'cancel', got %s", decision)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for RequestAction to return")
	}

	if mgr.GetState() != lifecycle.StateRunning {
		t.Errorf("expected StateRunning after checkout, got %v", mgr.GetState())
	}
}

func TestLifecycle_RequestAction_PromptCheckout_UserSkips(t *testing.T) {
	emitter := &fakeEmitter{}
	mgr := lifecycle.NewLinuxLifecycleManager(emitter)
	mgr.SetPromptChecker(func() bool {
		return true
	})

	decisionCh := make(chan string, 1)
	go func() {
		decision, err := mgr.RequestAction("reboot")
		if err != nil {
			decisionCh <- "error"
			return
		}
		decisionCh <- decision
	}()

	time.Sleep(50 * time.Millisecond)
	if mgr.GetState() != lifecycle.StateCheckingOut {
		t.Fatalf("expected StateCheckingOut, got %v", mgr.GetState())
	}

	// User clicks Skip (or closes dialog with X) -> ProceedAction / UserSkipped
	mgr.UserSkipped()

	select {
	case decision := <-decisionCh:
		if decision != "proceed" {
			t.Errorf("expected decision 'proceed', got %s", decision)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for RequestAction to return")
	}

	if mgr.GetState() != lifecycle.StateAllowExit {
		t.Errorf("expected StateAllowExit after skip, got %v", mgr.GetState())
	}
}

func TestLifecycle_ArmInhibitors_StateReset(t *testing.T) {
	emitter := &fakeEmitter{}
	mgr := lifecycle.NewLinuxLifecycleManager(emitter)
	mgr.SetPromptChecker(func() bool {
		return true
	})

	mgr.ProceedAction()
	if mgr.GetState() != lifecycle.StateAllowExit {
		t.Errorf("expected StateAllowExit after ProceedAction, got %v", mgr.GetState())
	}

	mgr.ArmInhibitors()
	if mgr.GetState() != lifecycle.StateRunning {
		t.Errorf("expected StateRunning after ArmInhibitors, got %v", mgr.GetState())
	}
}

func TestLifecycle_InstallExtension(t *testing.T) {
	err := lifecycle.InstallAndEnableExtension()
	if err != nil {
		t.Fatalf("InstallAndEnableExtension failed: %v", err)
	}
}

func TestLifecycle_ValidateAction(t *testing.T) {
	validTests := []struct {
		raw      string
		expected lifecycle.ActionType
	}{
		{"logout", lifecycle.ActionLogout},
		{"shutdown", lifecycle.ActionShutdown},
		{"power-off", lifecycle.ActionShutdown},
		{"poweroff", lifecycle.ActionShutdown},
		{"reboot", lifecycle.ActionReboot},
		{"restart", lifecycle.ActionReboot},
		{"LOGOUT", lifecycle.ActionLogout},
		{" Power-Off ", lifecycle.ActionShutdown},
		{"  Restart  ", lifecycle.ActionReboot},
	}

	for _, tt := range validTests {
		t.Run("Valid_"+tt.raw, func(t *testing.T) {
			act, ok := lifecycle.ValidateAction(tt.raw)
			if !ok {
				t.Fatalf("ValidateAction(%q) returned false, expected true", tt.raw)
			}
			if act != tt.expected {
				t.Errorf("ValidateAction(%q) = %v, expected %v", tt.raw, act, tt.expected)
			}
		})
	}

	invalidTests := []string{
		"",
		"   ",
		"sleep",
		"suspend",
		"hibernate",
		"lock",
		"unknown",
		"shutdown; rm -rf /",
		"logout\n",
		"power_off",
	}

	for _, raw := range invalidTests {
		t.Run("Invalid_"+raw, func(t *testing.T) {
			_, ok := lifecycle.ValidateAction(raw)
			if ok {
				t.Errorf("ValidateAction(%q) returned true, expected false", raw)
			}
		})
	}
}

func TestLifecycle_RequestAction_InvalidAction_ReturnsProceedFailOpen(t *testing.T) {
	emitter := &fakeEmitter{}
	mgr := lifecycle.NewLinuxLifecycleManager(emitter)
	mgr.SetPromptChecker(func() bool {
		return true
	})

	decision, err := mgr.RequestAction("invalid-action-xyz")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision != "proceed" {
		t.Errorf("expected decision 'proceed' on invalid action, got %q", decision)
	}
	if len(emitter.Events()) != 0 {
		t.Errorf("expected no events emitted for invalid action, got %v", emitter.Events())
	}
	if mgr.GetState() != lifecycle.StateRunning {
		t.Errorf("expected StateRunning, got %v", mgr.GetState())
	}
}

func TestLifecycle_RequestAction_ConcurrentRequests(t *testing.T) {
	emitter := &fakeEmitter{}
	mgr := lifecycle.NewLinuxLifecycleManager(emitter)
	mgr.SetPromptChecker(func() bool {
		return true
	})

	const count = 5
	decisions := make(chan string, count)
	var wg sync.WaitGroup

	for i := 0; i < count; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			decision, err := mgr.RequestAction("shutdown")
			if err != nil {
				decisions <- "error"
				return
			}
			decisions <- decision
		}()
	}

	time.Sleep(50 * time.Millisecond)
	mgr.UserSkipped()

	wg.Wait()
	close(decisions)

	// Exactly one request owns the dialog and resolves via UserSkipped → "proceed".
	// All other concurrent requests are immediately cancelled to prevent GNOME
	// from proceeding while the checkout dialog is still open.
	var nProceed, nCancel int
	for d := range decisions {
		switch d {
		case "proceed":
			nProceed++
		case "cancel":
			nCancel++
		default:
			t.Errorf("unexpected decision: %s", d)
		}
	}
	if nProceed != 1 {
		t.Errorf("expected exactly 1 'proceed', got %d", nProceed)
	}
	if nCancel != count-1 {
		t.Errorf("expected %d 'cancel' decisions, got %d", count-1, nCancel)
	}
}

func TestLifecycle_RequestAction_ManagerStopped_ReturnsProceed(t *testing.T) {
	emitter := &fakeEmitter{}
	mgr := lifecycle.NewLinuxLifecycleManager(emitter)
	mgr.SetPromptChecker(func() bool {
		return true
	})

	mgr.Stop()

	decision, err := mgr.RequestAction("shutdown")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decision != "proceed" {
		t.Errorf("expected decision 'proceed' when manager stopped, got %s", decision)
	}
}
