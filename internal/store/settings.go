package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"os"
)

type Settings struct {
	McpEnabled bool   `json:"mcpEnabled"`
	McpPort    int    `json:"mcpPort"`
	McpToken   string `json:"-"` // lives in the OS keyring, never in settings.json
	Prefs      Prefs  `json:"prefs"`
}

// Prefs are the user-facing UI/editor/query preferences edited in the Settings dialog.
type Prefs struct {
	// Appearance
	Theme      string `json:"theme"`      // dark | light | system
	FontFamily string `json:"fontFamily"` // empty = built-in monospace stack
	FontSize   int    `json:"fontSize"`
	Density    string `json:"density"` // comfortable | compact
	// Editor
	WordWrap    bool `json:"wordWrap"`
	Minimap     bool `json:"minimap"`
	LineNumbers bool `json:"lineNumbers"`
	TabSize     int  `json:"tabSize"`
	Autosave    bool `json:"autosave"`
	// Query
	RowLimit           int  `json:"rowLimit"`
	TimeoutSec         int  `json:"timeoutSec"` // 0 = no timeout
	ConfirmDestructive bool `json:"confirmDestructive"`
	// Layout / workspace
	SidebarWidth  int               `json:"sidebarWidth"`
	Keybindings   map[string]string `json:"keybindings"`
	RecentFolders []string          `json:"recentFolders"`
	LastFolder    string            `json:"lastFolder"`
}

func DefaultPrefs() Prefs {
	return Prefs{
		Theme: "dark", FontSize: 13, Density: "comfortable",
		LineNumbers: true, TabSize: 2,
		RowLimit: 1000, ConfirmDestructive: true,
		SidebarWidth: 280,
	}
}

func clamp(v, lo, hi int) int { return min(max(v, lo), hi) }

// Normalize coerces out-of-range or unknown values back into something the UI can render.
func (p *Prefs) Normalize() {
	switch p.Theme {
	case "dark", "light", "system":
	default:
		p.Theme = "dark"
	}
	if p.Density != "compact" {
		p.Density = "comfortable"
	}
	p.FontSize = clamp(p.FontSize, 9, 32)
	p.TabSize = clamp(p.TabSize, 1, 8)
	p.RowLimit = clamp(p.RowLimit, 1, 100000)
	p.TimeoutSec = clamp(p.TimeoutSec, 0, 3600)
	p.SidebarWidth = clamp(p.SidebarWidth, 180, 800)
	if len(p.RecentFolders) > 10 {
		p.RecentFolders = p.RecentFolders[:10]
	}
}

func (s *Store) Settings() Settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadSettings()
}

func (s *Store) loadSettings() Settings {
	// Pre-filled defaults survive for any key missing from an older settings.json.
	st := Settings{McpPort: 7733, Prefs: DefaultPrefs()}
	if b, err := os.ReadFile(s.path("settings.json")); err == nil {
		_ = json.Unmarshal(b, &st)
	}
	if st.McpPort == 0 {
		st.McpPort = 7733
	}
	st.Prefs.Normalize()
	st.McpToken = s.mcpToken()
	return st
}

const mcpTokenKey = "mcp-token"

// mcpToken reads the token from the secret store, caching it so frequent
// Settings() calls do not hit the keyring every time.
func (s *Store) mcpToken() string {
	if s.tokenCache == "" {
		s.tokenCache = s.secret(mcpTokenKey)
	}
	return s.tokenCache
}

// migrateLegacyToken moves a plaintext "mcpToken" from an old settings.json
// into the secret store and rewrites the file without it.
func (s *Store) migrateLegacyToken() {
	b, err := os.ReadFile(s.path("settings.json"))
	if err != nil {
		return
	}
	var legacy struct {
		McpToken string `json:"mcpToken"`
	}
	if json.Unmarshal(b, &legacy) != nil || legacy.McpToken == "" {
		return
	}
	if s.secret(mcpTokenKey) == "" {
		if err := s.setSecret(mcpTokenKey, legacy.McpToken); err != nil {
			slog.Error("settings: could not move MCP token to secret store", "err", err)
			return
		}
	}
	// Re-save without the plaintext token.
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.loadSettings()
	if out, err := json.MarshalIndent(st, "", "  "); err == nil {
		_ = os.WriteFile(s.path("settings.json"), out, 0o600)
	}
}

// UpdateSettings applies fn and persists. A missing MCP token is generated.
func (s *Store) UpdateSettings(fn func(*Settings)) (Settings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.loadSettings()
	fn(&st)
	st.Prefs.Normalize()
	if st.McpToken == "" {
		st.McpToken = NewToken()
	}
	if st.McpToken != s.mcpToken() {
		if err := s.setSecret(mcpTokenKey, st.McpToken); err != nil {
			return st, err
		}
		s.tokenCache = st.McpToken
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
