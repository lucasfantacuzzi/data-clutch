package main

import (
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"slices"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"data-clutch/internal/store"
	"data-clutch/internal/workspace"
)

var scriptFilter = []runtime.FileFilter{{DisplayName: "Scripts (*.sql, *.redis)", Pattern: "*.sql;*.redis"}}

// openFolder makes dir the workspace and records it as the last/recent folder.
func (a *App) openFolder(dir string) (string, error) {
	if err := a.ws.SetRoot(dir, func(paths []string) { runtime.EventsEmit(a.ctx, "fs:changed", paths) }); err != nil {
		return "", err
	}
	root := a.ws.Root()
	if _, err := a.store.UpdateSettings(func(s *store.Settings) {
		s.Prefs.LastFolder = root
		s.Prefs.RecentFolders = append([]string{root}, slices.DeleteFunc(slices.Clone(s.Prefs.RecentFolders), func(p string) bool { return p == root })...)
	}); err != nil {
		a.reportErr("settings", "could not remember the open folder", err)
	}
	return root, nil
}

// PickFolder asks for a folder and opens it. Returns "" when cancelled.
func (a *App) PickFolder() (string, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{Title: "Open folder"})
	if err != nil || dir == "" {
		return "", err
	}
	return a.openFolder(dir)
}

// OpenFolder opens a known path (recent folders, session restore).
func (a *App) OpenFolder(dir string) (string, error) {
	root, err := a.openFolder(dir)
	if err != nil {
		// a folder that vanished must not be offered again
		if _, uerr := a.store.UpdateSettings(func(s *store.Settings) {
			s.Prefs.RecentFolders = slices.DeleteFunc(slices.Clone(s.Prefs.RecentFolders), func(p string) bool { return p == dir })
			if s.Prefs.LastFolder == dir {
				s.Prefs.LastFolder = ""
			}
		}); uerr != nil {
			a.reportErr("settings", "could not update recent folders", uerr)
		}
	}
	return root, err
}

func (a *App) CloseFolder() {
	a.ws.Close()
	if _, err := a.store.UpdateSettings(func(s *store.Settings) { s.Prefs.LastFolder = "" }); err != nil {
		a.reportErr("settings", "could not clear the last folder", err)
	}
}

func (a *App) WorkspaceRoot() string { return a.ws.Root() }

func (a *App) ListDir(dir string) ([]workspace.Entry, error) { return a.ws.List(dir) }

func (a *App) WorkspaceFiles() ([]workspace.Entry, error) { return a.ws.Files(5000) }

func (a *App) ReadFile(path string) (string, error) { return a.ws.Read(path) }

func (a *App) WriteFile(path, content string) error { return a.ws.Write(path, content) }

func (a *App) CreateEntry(dir, name string, isDir bool) (string, error) {
	return a.ws.Create(dir, name, isDir)
}

func (a *App) RenameEntry(path, newName string) (string, error) { return a.ws.Rename(path, newName) }

func (a *App) DuplicateEntry(path string) (string, error) { return a.ws.Duplicate(path) }

func (a *App) MoveEntry(path, destDir string) (string, error) { return a.ws.Move(path, destDir) }

func (a *App) TrashEntry(path string) error { return a.ws.Trash(path) }

// PickOpenFile asks for a script anywhere on disk; the choice is whitelisted for read/write.
func (a *App) PickOpenFile() (string, error) {
	p, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "Open file", DefaultDirectory: a.ws.Root(), Filters: scriptFilter})
	if err != nil || p == "" {
		return "", err
	}
	a.approve(p)
	return p, nil
}

// PickSaveFile asks where to save; the choice is whitelisted for read/write.
func (a *App) PickSaveFile(defaultName string) (string, error) {
	p, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{Title: "Save as", DefaultDirectory: a.ws.Root(), DefaultFilename: defaultName, Filters: scriptFilter})
	if err != nil || p == "" {
		return "", err
	}
	if filepath.Ext(p) == "" { // the dialog does not add one; keep the file recognisable as a script
		ext := filepath.Ext(defaultName)
		if ext == "" {
			ext = ".sql"
		}
		p += ext
	}
	a.approve(p)
	return p, nil
}

// RevealInFileManager shows the entry in the system file manager.
func (a *App) RevealInFileManager(path string) error {
	p, err := a.ws.Resolve(path)
	if err != nil {
		return err
	}
	st, err := os.Stat(p)
	if err != nil {
		return err
	}
	var cmd *exec.Cmd
	switch goruntime.GOOS {
	case "darwin":
		cmd = exec.Command("open", "-R", p)
	case "windows":
		cmd = exec.Command("explorer", "/select,"+p)
	default:
		dir := p
		if !st.IsDir() {
			dir = filepath.Dir(p)
		}
		cmd = exec.Command("xdg-open", dir)
	}
	if cmd == nil {
		return errors.New("unsupported platform")
	}
	return cmd.Start()
}

const sessionFile = "session.json"

// SaveSession stores the UI's open tabs (opaque JSON) so the next start can restore them.
func (a *App) SaveSession(data string) error {
	if len(data) > 8<<20 {
		return errors.New("session too large")
	}
	path := filepath.Join(a.store.Dir(), sessionFile)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(data), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (a *App) LoadSession() string {
	b, err := os.ReadFile(filepath.Join(a.store.Dir(), sessionFile))
	if err != nil {
		return ""
	}
	return string(b)
}

const approvedFile = "approved.json"

// approve whitelists a dialog-chosen file and remembers it across restarts. Only
// native-dialog results reach here, so the list can never be written by the UI.
func (a *App) approve(p string) {
	a.ws.Approve(p)
	list := a.loadApproved()
	if !slices.Contains(list, p) {
		list = append(list, p)
		if len(list) > 200 {
			list = list[len(list)-200:]
		}
		b, _ := json.Marshal(list)
		if err := os.WriteFile(filepath.Join(a.store.Dir(), approvedFile), b, 0o600); err != nil {
			slog.Warn("could not remember approved file", "err", err)
		}
	}
}

func (a *App) loadApproved() []string {
	var list []string
	if b, err := os.ReadFile(filepath.Join(a.store.Dir(), approvedFile)); err == nil {
		_ = json.Unmarshal(b, &list)
	}
	return slices.DeleteFunc(list, func(p string) bool { return !filepath.IsAbs(p) || strings.ContainsRune(p, 0) })
}
