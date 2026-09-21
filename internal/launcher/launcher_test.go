package launcher_test

import (
	"testing"

	"time-check/internal/launcher"
)

func TestValidateURL(t *testing.T) {
	tests := []struct {
		name    string
		url     string
		wantErr bool
	}{
		// Valid URLs
		{name: "Valid HTTPS standard", url: "https://odoo.example.com", wantErr: false},
		{name: "Valid HTTPS with path and query", url: "https://odoo.example.com/web#cids=1&action=123", wantErr: false},
		{name: "Valid HTTPS localhost with port", url: "https://localhost:8069", wantErr: false},
		{name: "Valid HTTP local network", url: "http://192.168.1.50:8069", wantErr: false},
		{name: "Valid HTTP localhost", url: "http://localhost:8069", wantErr: false},

		// Empty or missing
		{name: "Empty URL", url: "", wantErr: true},

		// Dangerous / Disallowed schemes
		{name: "File scheme", url: "file:///etc/passwd", wantErr: true},
		{name: "Javascript scheme", url: "javascript:alert(1)", wantErr: true},
		{name: "Data scheme", url: "data:text/html,<html>alert</html>", wantErr: true},
		{name: "FTP scheme", url: "ftp://example.com/file", wantErr: true},
		{name: "Gopher scheme", url: "gopher://example.com", wantErr: true},
		{name: "Custom scheme", url: "custom-proto://execute", wantErr: true},

		// Shell injection & metacharacter attacks
		{name: "Shell with space and command", url: "https://example.com; rm -rf /", wantErr: true},
		{name: "Shell pipe with space", url: "https://example.com | cat /etc/passwd", wantErr: true},
		{name: "Shell background with space", url: "https://example.com & echo pwned", wantErr: true},
		{name: "Shell backticks", url: "https://example.com/`id`", wantErr: true},
		{name: "Quotes in URL", url: "https://example.com/\"'foo", wantErr: true},

		// Control characters
		{name: "Newline CRLF injection", url: "https://example.com\r\n", wantErr: true},
		{name: "Null byte injection", url: "https://example.com\x00", wantErr: true},
		{name: "Tab character", url: "https://example.com\tpath", wantErr: true},

		// Missing host
		{name: "HTTPS without host", url: "https://", wantErr: true},
		{name: "HTTP without host", url: "http://", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := launcher.ValidateURL(tt.url)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateURL(%q) error = %v, wantErr %v", tt.url, err, tt.wantErr)
			}
		})
	}
}
