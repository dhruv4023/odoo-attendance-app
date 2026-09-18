package launcher

import (
	"fmt"
	"os/exec"
)

// XDGLauncher opens URLs using xdg-open, the standard Linux URL opener.
// It validates the URL scheme before launching to prevent command injection.
type XDGLauncher struct{}

// Open validates and opens the given URL in the system's default browser.
// Only http and https schemes are accepted.
func (l *XDGLauncher) Open(rawURL string) error {
	if err := ValidateURL(rawURL); err != nil {
		return err
	}
	// Use exec.Command with explicit args — never via shell interpolation.
	cmd := exec.Command("xdg-open", rawURL)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("launcher: xdg-open: %w", err)
	}
	// Don't wait — xdg-open may block until the browser closes on some systems.
	go cmd.Wait() //nolint:errcheck
	return nil
}

// NewXDGLauncher returns a new XDGLauncher.
func NewXDGLauncher() *XDGLauncher {
	return &XDGLauncher{}
}
