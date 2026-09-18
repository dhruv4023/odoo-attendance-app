// Package storage provides atomic JSON persistence in the XDG config directory.
package storage

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// Store persists and retrieves JSON-encoded values.
type Store interface {
	// ReadJSON reads the named file and decodes JSON into v.
	ReadJSON(name string, v interface{}) error
	// WriteJSON encodes v as JSON and atomically writes it to the named file.
	WriteJSON(name string, v interface{}) error
	// Dir returns the storage directory path.
	Dir() string
}

// ErrNotFound is returned by ReadJSON when the file does not exist.
var ErrNotFound = errors.New("storage: file not found")

// FileStore is a Store backed by the XDG config home directory.
type FileStore struct {
	dir string
}

// NewFileStore creates a FileStore rooted at $XDG_CONFIG_HOME/time-check
// (defaults to ~/.config/time-check).
func NewFileStore() (*FileStore, error) {
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("storage: cannot locate home directory: %w", err)
		}
		base = filepath.Join(home, ".config")
	}
	dir := filepath.Join(base, "time-check")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("storage: cannot create config dir %s: %w", dir, err)
	}
	return &FileStore{dir: dir}, nil
}

// NewFileStoreAt creates a FileStore rooted at the given directory. Used in tests.
func NewFileStoreAt(dir string) (*FileStore, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("storage: cannot create dir %s: %w", dir, err)
	}
	return &FileStore{dir: dir}, nil
}

// Dir returns the storage directory.
func (s *FileStore) Dir() string { return s.dir }

// ReadJSON reads and decodes a named JSON file.
func (s *FileStore) ReadJSON(name string, v interface{}) error {
	path := filepath.Join(s.dir, name)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return ErrNotFound
		}
		return fmt.Errorf("storage: read %s: %w", name, err)
	}
	if err := json.Unmarshal(data, v); err != nil {
		return fmt.Errorf("storage: decode %s: %w", name, err)
	}
	return nil
}

// WriteJSON atomically encodes and writes a named JSON file.
// It writes to a temp file first, then renames to ensure atomicity.
func (s *FileStore) WriteJSON(name string, v interface{}) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Errorf("storage: encode %s: %w", name, err)
	}
	// Write to a temp file in the same directory.
	tmp, err := os.CreateTemp(s.dir, ".tmp-")
	if err != nil {
		return fmt.Errorf("storage: create temp: %w", err)
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("storage: write temp: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("storage: sync temp: %w", err)
	}
	tmp.Close()
	dest := filepath.Join(s.dir, name)
	if err := os.Rename(tmpPath, dest); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("storage: rename to %s: %w", dest, err)
	}
	return nil
}
