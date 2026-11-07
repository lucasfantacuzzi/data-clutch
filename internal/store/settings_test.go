package store

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSettingsMigrateOldFile(t *testing.T) {
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
