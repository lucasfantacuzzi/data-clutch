package store

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/zalando/go-keyring"
)

func TestMain(m *testing.M) {
	keyring.MockInit() // never touch the developer's real keyring
	os.Exit(m.Run())
}

func TestSettingsMigrateOldFile(t *testing.T) {
	keyring.MockInit()
	dir := t.TempDir()
	// settings.json written before Prefs existed
	old := `{"mcpEnabled":true,"mcpPort":9000,"mcpToken":"abc"}`
	if err := os.WriteFile(filepath.Join(dir, "settings.json"), []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	st := s.Settings()
	if !st.McpEnabled || st.McpPort != 9000 || st.McpToken != "abc" {
		t.Fatalf("mcp settings lost: %+v", st)
	}
	want := DefaultPrefs()
	if st.Prefs.Theme != want.Theme || st.Prefs.RowLimit != 1000 || !st.Prefs.LineNumbers || !st.Prefs.ConfirmDestructive {
		t.Fatalf("defaults not applied: %+v", st.Prefs)
	}
}

func TestPrefsNormalizeAndPersist(t *testing.T) {
	keyring.MockInit()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	st, err := s.UpdateSettings(func(st *Settings) {
		st.Prefs.Theme = "neon"
		st.Prefs.FontSize = 500
		st.Prefs.TabSize = 0
		st.Prefs.RowLimit = -3
		st.Prefs.TimeoutSec = -1
		st.Prefs.Density = "weird"
	})
	if err != nil {
		t.Fatal(err)
	}
	p := st.Prefs
	if p.Theme != "dark" || p.FontSize != 32 || p.TabSize != 1 || p.RowLimit != 1 || p.TimeoutSec != 0 || p.Density != "comfortable" {
		t.Fatalf("not normalized: %+v", p)
	}
	if got := s.Settings().Prefs; got.FontSize != 32 {
		t.Fatalf("not persisted: %+v", got)
	}
}

func TestMcpTokenLivesInKeyringNotFile(t *testing.T) {
	keyring.MockInit()
	dir := t.TempDir()
	old := `{"mcpEnabled":true,"mcpPort":9000,"mcpToken":"legacy-token"}`
	os.WriteFile(filepath.Join(dir, "settings.json"), []byte(old), 0o600)
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := s.Settings().McpToken; got != "legacy-token" {
		t.Fatalf("legacy token lost: %q", got)
	}
	if v, err := keyring.Get(keyringService, mcpTokenKey); err != nil || v != "legacy-token" {
		t.Fatalf("token not in keyring: %q %v", v, err)
	}
	// a regenerated token must also stay out of the file
	st, err := s.UpdateSettings(func(st *Settings) { st.McpToken = NewToken() })
	if err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(filepath.Join(dir, "settings.json"))
	if strings.Contains(string(b), "legacy-token") || strings.Contains(string(b), st.McpToken) || strings.Contains(string(b), "mcpToken") {
		t.Fatalf("token leaked into settings.json: %s", b)
	}
	if s.InsecureSecrets() {
		t.Fatal("keyring was available, fallback must stay empty")
	}
}

func TestMcpTokenFallbackWhenNoKeyring(t *testing.T) {
	keyring.MockInitWithError(errors.New("no secret service"))
	defer keyring.MockInit()
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	st, err := s.UpdateSettings(func(*Settings) {})
	if err != nil || st.McpToken == "" {
		t.Fatalf("token not generated: %v", err)
	}
	if !s.InsecureSecrets() {
		t.Fatal("fallback should be reported")
	}
	if s.Settings().McpToken != st.McpToken {
		t.Fatal("token not readable from fallback")
	}
}
