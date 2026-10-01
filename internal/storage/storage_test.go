package storage_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"odoo-attendance-app/internal/storage"
)

func newTestStore(t *testing.T) (*storage.FileStore, string) {
	t.Helper()
	dir := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", dir)
	s, err := storage.NewFileStore()
	if err != nil {
		t.Fatalf("NewFileStore: %v", err)
	}
	storeDir := filepath.Join(dir, "odoo-attendance-app")
	return s, storeDir
}

func TestWriteAndReadJSON(t *testing.T) {
	s, _ := newTestStore(t)
	type payload struct {
		Name string `json:"name"`
		Age  int    `json:"age"`
	}
	in := payload{Name: "Alice", Age: 30}
	if err := s.WriteJSON("test.json", in); err != nil {
		t.Fatalf("WriteJSON: %v", err)
	}
	var out payload
	if err := s.ReadJSON("test.json", &out); err != nil {
		t.Fatalf("ReadJSON: %v", err)
	}
	if out != in {
		t.Errorf("got %+v, want %+v", out, in)
	}
}

func TestReadJSONNotFound(t *testing.T) {
	s, _ := newTestStore(t)
	var v interface{}
	err := s.ReadJSON("missing.json", &v)
	if !errors.Is(err, storage.ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

func TestWriteJSONAtomic(t *testing.T) {
	s, storeDir := newTestStore(t)
	// Ensure no lingering temp files after write.
	if err := s.WriteJSON("data.json", map[string]int{"x": 1}); err != nil {
		t.Fatalf("WriteJSON: %v", err)
	}
	entries, err := os.ReadDir(storeDir)
	if err != nil {
		t.Fatalf("os.ReadDir: %v", err)
	}
	for _, e := range entries {
		if e.Name() != "data.json" {
			t.Errorf("unexpected file %s in store dir", e.Name())
		}
	}
}

func TestWriteJSONOverwrite(t *testing.T) {
	s, _ := newTestStore(t)
	if err := s.WriteJSON("d.json", map[string]int{"v": 1}); err != nil {
		t.Fatal(err)
	}
	if err := s.WriteJSON("d.json", map[string]int{"v": 2}); err != nil {
		t.Fatal(err)
	}
	var v map[string]int
	if err := s.ReadJSON("d.json", &v); err != nil {
		t.Fatal(err)
	}
	if v["v"] != 2 {
		t.Errorf("expected 2, got %d", v["v"])
	}
}

func TestNewFileStore(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)
	s, err := storage.NewFileStore()
	if err != nil {
		t.Fatalf("NewFileStore: %v", err)
	}
	if err := s.WriteJSON("check.json", map[string]string{"ok": "true"}); err != nil {
		t.Fatalf("WriteJSON: %v", err)
	}
	target := filepath.Join(tmp, "odoo-attendance-app", "check.json")
	if _, err := os.Stat(target); err != nil {
		t.Errorf("expected file at %s: %v", target, err)
	}
}

func TestStorage_PathTraversalPrevention(t *testing.T) {
	s, _ := newTestStore(t)
	traversalNames := []string{
		"../test.json",
		"../../etc/passwd",
		"/etc/passwd",
		"sub/folder.json",
		".",
		"..",
		"",
	}

	for _, name := range traversalNames {
		t.Run("Write_"+name, func(t *testing.T) {
			err := s.WriteJSON(name, map[string]string{"foo": "bar"})
			if !errors.Is(err, storage.ErrInvalidFileName) {
				t.Errorf("expected ErrInvalidFileName for WriteJSON(%q), got %v", name, err)
			}
		})

		t.Run("Read_"+name, func(t *testing.T) {
			var v interface{}
			err := s.ReadJSON(name, &v)
			if !errors.Is(err, storage.ErrInvalidFileName) {
				t.Errorf("expected ErrInvalidFileName for ReadJSON(%q), got %v", name, err)
			}
		})
	}
}

func TestStorage_FilePermissions(t *testing.T) {
	s, storeDir := newTestStore(t)
	if err := s.WriteJSON("secure.json", map[string]string{"secret": "val"}); err != nil {
		t.Fatalf("WriteJSON: %v", err)
	}

	path := filepath.Join(storeDir, "secure.json")
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}

	// Mode should be 0600 (-rw-------)
	perm := fi.Mode().Perm()
	if perm != 0600 {
		t.Errorf("expected file mode 0600, got %o", perm)
	}
}

func TestStorage_SymlinkProtection(t *testing.T) {
	s, storeDir := newTestStore(t)
	targetPath := filepath.Join(t.TempDir(), "target.json")
	_ = os.WriteFile(targetPath, []byte(`{"initial":"data"}`), 0600)

	symlinkPath := filepath.Join(storeDir, "link.json")
	if err := os.Symlink(targetPath, symlinkPath); err != nil {
		t.Fatalf("failed to create test symlink: %v", err)
	}

	// Writing to link.json should not overwrite target.json
	newPayload := map[string]string{"updated": "value"}
	if err := s.WriteJSON("link.json", newPayload); err != nil {
		t.Fatalf("WriteJSON on symlink path failed: %v", err)
	}

	// Verify target.json was NOT overwritten through the symlink
	targetContent, _ := os.ReadFile(targetPath)
	if string(targetContent) != `{"initial":"data"}` {
		t.Errorf("target file was overwritten through symlink! Content: %s", string(targetContent))
	}
}
