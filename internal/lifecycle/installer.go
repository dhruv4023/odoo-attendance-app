package lifecycle

import (
	_ "embed"
	"bytes"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const ExtensionUUID = "time-check-attendance"

//go:embed gnome-extension/metadata.json
var embeddedMetadata []byte

//go:embed gnome-extension/extension.js
var embeddedExtensionJS []byte

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

	// Write metadata.json if missing or outdated
	metaPath := filepath.Join(extDir, "metadata.json")
	if isFileDifferent(metaPath, embeddedMetadata) {
		if err := os.WriteFile(metaPath, embeddedMetadata, 0644); err != nil {
			return fmt.Errorf("write metadata.json: %w", err)
		}
		log.Printf("lifecycle: installed extension metadata at %s", metaPath)
	}

	// Write extension.js if missing or outdated
	jsPath := filepath.Join(extDir, "extension.js")
	if isFileDifferent(jsPath, embeddedExtensionJS) {
		if err := os.WriteFile(jsPath, embeddedExtensionJS, 0644); err != nil {
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
