package notification

import (
	"fmt"
	"os/exec"

	"github.com/godbus/dbus/v5"
)

// LibnotifyNotifier sends notifications via notify-send.
type LibnotifyNotifier struct{}

func (n *LibnotifyNotifier) Notify(title, body string) error {
	cmd := exec.Command("notify-send",
		"--app-name=TimeCheck",
		"--urgency=normal",
		"--expire-time=10000",
		title,
		body,
	)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("notify-send: %w", err)
	}
	return nil
}

// DBusNotifier sends notifications directly via D-Bus (fallback).
type DBusNotifier struct{}

func (n *DBusNotifier) Notify(title, body string) error {
	conn, err := dbus.SessionBus()
	if err != nil {
		return fmt.Errorf("dbus: connect: %w", err)
	}
	obj := conn.Object("org.freedesktop.Notifications", "/org/freedesktop/Notifications")
	call := obj.Call("org.freedesktop.Notifications.Notify", 0,
		"TimeCheck", // app_name
		uint32(0),            // replaces_id
		"",                   // app_icon
		title,                // summary
		body,                 // body
		[]string{},           // actions
		map[string]dbus.Variant{}, // hints
		int32(10000),         // expire_timeout (ms)
	)
	if call.Err != nil {
		return fmt.Errorf("dbus notify: %w", call.Err)
	}
	return nil
}

// NewBestNotifier returns the best available notifier for the current system.
// It prefers notify-send (more compatible), falls back to direct D-Bus.
func NewBestNotifier() Notifier {
	if _, err := exec.LookPath("notify-send"); err == nil {
		return &LibnotifyNotifier{}
	}
	return &DBusNotifier{}
}
