package main

import "data-clutch/internal/store"

// GetPrefs returns the user preferences edited in the Settings dialog.
func (a *App) GetPrefs() store.Prefs { return a.store.Settings().Prefs }

// SetPrefs replaces the preferences and returns the normalized result.
// MCP settings are left alone: they have their own methods.
func (a *App) SetPrefs(p store.Prefs) store.Prefs {
	st, err := a.store.UpdateSettings(func(s *store.Settings) { s.Prefs = p })
	if err != nil {
		a.reportErr("prefs", "could not save preferences", err)
	}
	return st.Prefs
}
