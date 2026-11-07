// Package store persists connection configs; passwords go to the OS keyring.
package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"

	"github.com/google/uuid"
	"github.com/zalando/go-keyring"

	"data-clutch/internal/conn"
)

const keyringService = "data-clutch"

type Store struct {
	dir string

	mu    sync.Mutex
	conns []conn.Config
}

func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &Store{dir: dir}
	b, err := os.ReadFile(s.path("connections.json"))
	if err == nil {
		if err := json.Unmarshal(b, &s.conns); err != nil {
			return nil, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return s, nil
}

func DefaultDir() (string, error) {
	d, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "data-clutch"), nil
}

func (s *Store) path(n string) string { return filepath.Join(s.dir, n) }

// List returns configs without passwords.
func (s *Store) List() []conn.Config {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]conn.Config{}, s.conns...)
}

// Get returns the config with its password filled in.
func (s *Store) Get(id string) (conn.Config, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range s.conns {
		if c.ID == id {
			c.Password = s.secret(id)
			return c, true
		}
	}
	return conn.Config{}, false
}

// Save inserts or updates. An empty Password on an existing config keeps the stored one.
func (s *Store) Save(c conn.Config) (conn.Config, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if c.ID == "" {
		c.ID = uuid.NewString()
	}
	pw := c.Password
	c.Password = ""
	replaced := false
	for i := range s.conns {
		if s.conns[i].ID == c.ID {
			s.conns[i] = c
			replaced = true
		}
	}
	if !replaced {
		s.conns = append(s.conns, c)
	}
	if pw != "" {
		if err := s.setSecret(c.ID, pw); err != nil {
			return c, err
		}
	}
	return c, s.flush()
}

func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := s.conns[:0]
	for _, c := range s.conns {
		if c.ID != id {
			out = append(out, c)
		}
	}
	s.conns = out
	s.delSecret(id)
	return s.flush()
}

func (s *Store) flush() error {
	b, err := json.MarshalIndent(s.conns, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path("connections.json"), b, 0o600)
}

// Secrets: OS keyring first; if no keyring is available (headless), fall back
// to a 0600 file in the config dir.
func (s *Store) secret(id string) string {
	if v, err := keyring.Get(keyringService, id); err == nil {
		return v
	}
	return s.readFallback()[id]
}

func (s *Store) setSecret(id, pw string) error {
	if err := keyring.Set(keyringService, id, pw); err == nil {
		return nil
	}
	m := s.readFallback()
	m[id] = pw
	return s.writeFallback(m)
}

func (s *Store) delSecret(id string) {
	_ = keyring.Delete(keyringService, id)
	m := s.readFallback()
	if _, ok := m[id]; ok {
		delete(m, id)
		_ = s.writeFallback(m)
	}
}

func (s *Store) readFallback() map[string]string {
	m := map[string]string{}
	if b, err := os.ReadFile(s.path("secrets.json")); err == nil {
		_ = json.Unmarshal(b, &m)
	}
	return m
}

func (s *Store) writeFallback(m map[string]string) error {
	b, _ := json.Marshal(m)
	return os.WriteFile(s.path("secrets.json"), b, 0o600)
}
