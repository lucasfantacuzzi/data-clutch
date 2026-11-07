package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
)

type Settings struct {
	McpEnabled bool   `json:"mcpEnabled"`
	McpPort    int    `json:"mcpPort"`
	McpToken   string `json:"mcpToken"`
}

func (s *Store) Settings() Settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadSettings()
}

func (s *Store) loadSettings() Settings {
	st := Settings{McpPort: 7733}
	if b, err := os.ReadFile(s.path("settings.json")); err == nil {
		_ = json.Unmarshal(b, &st)
	}
	if st.McpPort == 0 {
		st.McpPort = 7733
	}
	return st
}

// UpdateSettings applies fn and persists. A missing MCP token is generated.
func (s *Store) UpdateSettings(fn func(*Settings)) (Settings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.loadSettings()
	fn(&st)
	if st.McpToken == "" {
		st.McpToken = NewToken()
	}
	b, _ := json.MarshalIndent(st, "", "  ")
	return st, os.WriteFile(s.path("settings.json"), b, 0o600)
}

func NewToken() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *Store) Dir() string { return s.dir }
