package lifecycle

import (
	_ "embed"
	"bytes"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

const ExtensionUUID = "time-check-attendance"

//go:embed gnome-extension/modern/metadata.json
var embeddedMetadataModern []byte

//go:embed gnome-extension/modern/extension.js
var embeddedExtensionJSModern []byte

//go:embed gnome-extension/legacy/metadata.json
var embeddedMetadataLegacy []byte

//go:embed gnome-extension/legacy/extension.js
var embeddedExtensionJSLegacy []byte

// GetGnomeShellMajorVersion detects the major version of GNOME Shell (e.g. 42, 45, 46).
// Returns 0 if GNOME Shell is not found or version cannot be parsed.
func GetGnomeShellMajorVersion() int {
	out, err := exec.Command("gnome-shell", "--version").Output()
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(out))
	for _, f := range fields {
		parts := strings.Split(f, ".")
		if len(parts) >= 1 {
			if v, err := strconv.Atoi(parts[0]); err == nil && v >= 30 && v <= 99 {
				return v
			}
		}
	}
	return 0
}

// selectExtensionPayloads chooses the correct extension metadata and script based on GNOME Shell version.
func selectExtensionPayloads() ([]byte, []byte) {
	major := GetGnomeShellMajorVersion()
	if major > 0 && major < 45 {
		log.Printf("lifecycle: detected GNOME Shell %d (< 45), installing legacy GJS extension (GNOME 42-44)", major)
		return embeddedMetadataLegacy, embeddedExtensionJSLegacy
	}
	log.Printf("lifecycle: detected GNOME Shell %d (>= 45), installing modern ESM extension (GNOME 45+)", major)
	return embeddedMetadataModern, embeddedExtensionJSModern
}

// InstallAndEnableExtension ensures the GNOME Shell extension is installed in
// ~/.local/share/gnome-shell/extensions/<UUID>/ and enabled.
func InstallAndEnableExtension() error {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("user home dir: %w", err)
	}

	extDir := filepath.Join(homeDir, ".local", "share", "gnome-shell", "extensions", ExtensionUUID)
	if err := os.MkdirAll(extDir, 0755); err != nil {
		return fmt.Errorf("mkdir extension dir %s: %w", extDir, err)
	}

	metadataPayload, jsPayload := selectExtensionPayloads()

	// Write metadata.json if missing or outdated
	metaPath := filepath.Join(extDir, "metadata.json")
	if isFileDifferent(metaPath, metadataPayload) {
		if err := os.WriteFile(metaPath, metadataPayload, 0644); err != nil {
			return fmt.Errorf("write metadata.json: %w", err)
		}
		log.Printf("lifecycle: installed extension metadata at %s", metaPath)
	}

	// Write extension.js if missing or outdated
	jsPath := filepath.Join(extDir, "extension.js")
	if isFileDifferent(jsPath, jsPayload) {
		if err := os.WriteFile(jsPath, jsPayload, 0644); err != nil {
			return fmt.Errorf("write extension.js: %w", err)
		}
		log.Printf("lifecycle: installed extension.js at %s", jsPath)
	}

	// Enable extension via gnome-extensions CLI or GSettings
	enableExtension()
	return nil
}

func isFileDifferent(filePath string, expectedContent []byte) bool {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return true
	}
	return !bytes.Equal(content, expectedContent)
}

func enableExtension() {
	// 1. Ensure user extensions master switch is enabled
	_ = exec.Command("gsettings", "set", "org.gnome.shell", "disable-user-extensions", "false").Run()

	// 2. Add to org.gnome.shell enabled-extensions if not present
	getCmd := exec.Command("gsettings", "get", "org.gnome.shell", "enabled-extensions")
	out, err := getCmd.Output()
	if err == nil {
		raw := strings.TrimSpace(string(out))
		if !strings.Contains(raw, ExtensionUUID) {
			trimmed := strings.Trim(raw, "[]'\" \t\n")
			var items []string
			if trimmed != "" {
				for _, item := range strings.Split(trimmed, ",") {
					clean := strings.Trim(item, " '\"")
					if clean != "" {
						items = append(items, fmt.Sprintf("'%s'", clean))
					}
				}
			}
			items = append(items, fmt.Sprintf("'%s'", ExtensionUUID))
			newVal := fmt.Sprintf("[%s]", strings.Join(items, ", "))

			setCmd := exec.Command("gsettings", "set", "org.gnome.shell", "enabled-extensions", newVal)
			if setOut, setErr := setCmd.CombinedOutput(); setErr != nil {
				log.Printf("lifecycle: gsettings set enabled-extensions error: %v, out: %s", setErr, strings.TrimSpace(string(setOut)))
			} else {
				log.Printf("lifecycle: enabled gnome extension %s via gsettings", ExtensionUUID)
			}
		}
	}

	// 3. Try gnome-extensions enable command
	cmd := exec.Command("gnome-extensions", "enable", ExtensionUUID)
	if out, err := cmd.CombinedOutput(); err == nil {
		log.Printf("lifecycle: enabled gnome extension %s", ExtensionUUID)
	} else {
		log.Printf("lifecycle: gnome-extensions enable output: %s (%v)", strings.TrimSpace(string(out)), err)
	}
}
