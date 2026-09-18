// Package launcher defines the URLLauncher interface and Linux implementations.
package launcher

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// URLLauncher opens URLs in the system's default browser.
type URLLauncher interface {
	Open(rawURL string) error
}

// ErrInvalidURL is returned when the URL scheme is not http or https.
var ErrInvalidURL = errors.New("launcher: only http and https URLs are supported")

// ValidateURL validates that rawURL is a safe http or https URL.
func ValidateURL(rawURL string) error {
	if rawURL == "" {
		return errors.New("launcher: URL is empty")
	}

	// Reject whitespace, newlines, null bytes or shell escaping characters
	if strings.ContainsAny(rawURL, " \t\r\n\x00\"'`<>") {
		return errors.New("launcher: URL contains forbidden or control characters")
	}

	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("launcher: invalid URL: %w", err)
	}

	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return ErrInvalidURL
	}

	if u.Hostname() == "" {
		return errors.New("launcher: URL has no host")
	}

	return nil
}
