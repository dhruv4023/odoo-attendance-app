// Package launcher defines the URLLauncher interface and Linux implementations.
package launcher

import (
	"errors"
	"fmt"
	"net/url"
)

// URLLauncher opens URLs in the system's default browser.
type URLLauncher interface {
	Open(rawURL string) error
}

// ErrInvalidURL is returned when the URL scheme is not http or https.
var ErrInvalidURL = errors.New("launcher: only http and https URLs are supported")

// ValidateURL validates that rawURL is an http or https URL.
func ValidateURL(rawURL string) error {
	if rawURL == "" {
		return errors.New("launcher: URL is empty")
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("launcher: invalid URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return ErrInvalidURL
	}
	if u.Host == "" {
		return errors.New("launcher: URL has no host")
	}
	return nil
}
