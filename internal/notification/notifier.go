// Package notification defines the Notifier interface and Linux implementations.
package notification

// Notifier sends desktop notifications.
type Notifier interface {
	Notify(title, body string) error
}
