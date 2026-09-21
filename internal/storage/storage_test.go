package storage_test

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"time-check/internal/storage"
)

func newTestStore(t *testing.T) *storage.FileStore {
	t.Helper()
	dir := t.TempDir()
	s, err := storage.NewFileStoreAt(dir)
	if err != nil {
		t.Fatalf("NewFileStoreAt: %v", err)
	}
	return s
}

func TestWriteAndReadJSON(t *testing.T) {
	s := newTestStore(t)
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
	s := newTestStore(t)
	var v interface{}
	err := s.ReadJSON("missing.json", &v)
	if !errors.Is(err, storage.ErrNotFound) {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

func TestWriteJSONAtomic(t *testing.T) {
	s := newTestStore(t)
	// Ensure no lingering temp files after write.
	if err := s.WriteJSON("data.json", map[string]int{"x": 1}); err != nil {
		t.Fatalf("WriteJSON: %v", err)
	}
	entries, _ := os.ReadDir(s.Dir())
	for _, e := range entries {
		if e.Name() != "data.json" {
			t.Errorf("unexpected file %s in store dir", e.Name())
		}
	}
}

func TestDir(t *testing.T) {
	dir := t.TempDir()
	s, _ := storage.NewFileStoreAt(dir)
	if s.Dir() != dir {
		t.Errorf("Dir() = %q, want %q", s.Dir(), dir)
	}
}

func TestWriteJSONOverwrite(t *testing.T) {
	s := newTestStore(t)
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
	// Use XDG_CONFIG_HOME override to avoid polluting the real home dir.
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)
	s, err := storage.NewFileStore()
	if err != nil {
		t.Fatalf("NewFileStore: %v", err)
	}
	want := filepath.Join(tmp, "time-check")
	if s.Dir() != want {
		t.Errorf("Dir() = %q, want %q", s.Dir(), want)
	}
}

func TestStorage_PathTraversalPrevention(t *testing.T) {
	s := newTestStore(t)
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
	s := newTestStore(t)
	if err := s.WriteJSON("secure.json", map[string]string{"secret": "val"}); err != nil {
		t.Fatalf("WriteJSON: %v", err)
	}

	path := filepath.Join(s.Dir(), "secure.json")
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
	s := newTestStore(t)
	targetPath := filepath.Join(t.TempDir(), "target.json")
	_ = os.WriteFile(targetPath, []byte(`{"initial":"data"}`), 0600)

	symlinkPath := filepath.Join(s.Dir(), "link.json")
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

