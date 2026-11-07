// Package workspace is the sandboxed filesystem layer behind the "Files" tree:
// every path the UI hands us is resolved (symlinks included) and must live under
// the opened folder, or be a file the user picked in a native dialog.
package workspace

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/Bios-Marcel/wastebasket/v2"
)

const maxFileSize = 5 << 20

var ErrOutside = errors.New("path is outside the open folder")

type Entry struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	IsDir bool   `json:"isDir"`
}

type Workspace struct {
	mu       sync.Mutex
	root     string          // absolute, symlinks resolved; empty = no folder open
	approved map[string]bool // files chosen through native dialogs
	watch    *watcher
}

func New() *Workspace { return &Workspace{approved: map[string]bool{}} }

// IsScript reports whether the tree shows a file with this name.
func IsScript(name string) bool {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".sql", ".redis":
		return true
	}
	return false
}

func skipDir(name string) bool { return strings.HasPrefix(name, ".") || name == "node_modules" }

func (w *Workspace) Root() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.root
}

// SetRoot opens dir as the workspace (empty closes it) and starts watching it.
func (w *Workspace) SetRoot(dir string, onChange func(paths []string)) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.watch != nil {
		w.watch.close()
		w.watch = nil
	}
	if dir == "" {
		w.root = ""
		return nil
	}
	real, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return err
	}
	real, err = filepath.Abs(real)
	if err != nil {
		return err
	}
	if st, err := os.Stat(real); err != nil || !st.IsDir() {
		return fmt.Errorf("%s is not a folder", dir)
	}
	w.root = real
	if onChange != nil {
		w.watch = startWatcher(real, onChange) // nil when the OS refuses; the tree then refreshes manually
	}
	return nil
}

func (w *Workspace) Close() { _ = w.SetRoot("", nil) }

// Approve whitelists a single file the user picked in a native dialog.
func (w *Workspace) Approve(path string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.approved[filepath.Clean(path)] = true
}

// realPath resolves symlinks of the longest existing prefix, so paths that do
// not exist yet (new files) are still checked against where they would land.
func realPath(p string) (string, error) {
	p = filepath.Clean(p)
	var tail []string
	for {
		r, err := filepath.EvalSymlinks(p)
		if err == nil {
			for i := len(tail) - 1; i >= 0; i-- {
				r = filepath.Join(r, tail[i])
			}
			return r, nil
		}
		if !errors.Is(err, fs.ErrNotExist) {
			return "", err
		}
		parent := filepath.Dir(p)
		if parent == p {
			return "", err
		}
		tail = append(tail, filepath.Base(p))
		p = parent
	}
}

func within(root, p string) bool {
	return p == root || strings.HasPrefix(p, root+string(filepath.Separator))
}

func (w *Workspace) resolve(path string, allowApproved bool) (string, error) {
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("path must be absolute: %q", path)
	}
	clean := filepath.Clean(path)
	w.mu.Lock()
	root, ok := w.root, w.approved[clean]
	w.mu.Unlock()
	if allowApproved && ok {
		return clean, nil
	}
	if root == "" {
		return "", errors.New("no folder is open")
	}
	real, err := realPath(clean)
	if err != nil {
		return "", err
	}
	if !within(root, real) {
		return "", ErrOutside
	}
	return real, nil
}

// Resolve validates a path for read/write access and returns its canonical form.
func (w *Workspace) Resolve(path string) (string, error) { return w.resolve(path, true) }

func validName(name string) error {
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, `/\`) || strings.ContainsRune(name, 0) {
		return fmt.Errorf("invalid name %q", name)
	}
	return nil
}

// List returns the sub-folders and script files of dir (dirs first, then by name).
func (w *Workspace) List(dir string) ([]Entry, error) {
	d, err := w.resolve(dir, false)
	if err != nil {
		return nil, err
	}
	des, err := os.ReadDir(d)
	if err != nil {
		return nil, err
	}
	out := []Entry{}
	for _, de := range des {
		name := de.Name()
		isDir := de.IsDir()
		if de.Type()&fs.ModeSymlink != 0 { // follow only links that stay inside the folder
			if _, err := w.resolve(filepath.Join(d, name), false); err != nil {
				continue
			}
			if st, err := os.Stat(filepath.Join(d, name)); err == nil {
				isDir = st.IsDir()
			}
		}
		if isDir && skipDir(name) || !isDir && !IsScript(name) {
			continue
		}
		out = append(out, Entry{Name: name, Path: filepath.Join(d, name), IsDir: isDir})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].IsDir != out[j].IsDir {
			return out[i].IsDir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out, nil
}

// Files lists every script under the root (for quick-open), at most max.
func (w *Workspace) Files(max int) ([]Entry, error) {
	root := w.Root()
	if root == "" {
		return []Entry{}, nil
	}
	out := []Entry{}
	err := filepath.WalkDir(root, func(p string, de fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if de.IsDir() {
			if p != root && skipDir(de.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if de.Type().IsRegular() && IsScript(de.Name()) {
			out = append(out, Entry{Name: de.Name(), Path: p})
			if len(out) >= max {
				return io.EOF
			}
		}
		return nil
	})
	if err != nil && err != io.EOF {
		return nil, err
	}
	return out, nil
}

func (w *Workspace) Read(path string) (string, error) {
	p, err := w.resolve(path, true)
	if err != nil {
		return "", err
	}
	st, err := os.Stat(p)
	if err != nil {
		return "", err
	}
	if st.IsDir() {
		return "", errors.New("is a folder")
	}
	if st.Size() > maxFileSize {
		return "", fmt.Errorf("file is larger than %d MB", maxFileSize>>20)
	}
	b, err := os.ReadFile(p)
	return string(b), err
}

// Write replaces the file atomically (temp file + rename), keeping its mode.
func (w *Workspace) Write(path, content string) error {
	p, err := w.resolve(path, true)
	if err != nil {
		return err
	}
	mode := fs.FileMode(0o644)
	if st, err := os.Stat(p); err == nil {
		mode = st.Mode().Perm()
	}
	tmp, err := os.CreateTemp(filepath.Dir(p), ".clutch-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.WriteString(content); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Chmod(mode); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), p)
}

func (w *Workspace) Create(dir, name string, isDir bool) (string, error) {
	if err := validName(name); err != nil {
		return "", err
	}
	d, err := w.resolve(dir, false)
	if err != nil {
		return "", err
	}
	p := filepath.Join(d, name)
	if _, err := os.Lstat(p); err == nil {
		return "", fmt.Errorf("%q already exists", name)
	}
	if isDir {
		return p, os.Mkdir(p, 0o755)
	}
	f, err := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return "", err
	}
	return p, f.Close()
}

func (w *Workspace) Rename(path, newName string) (string, error) {
	if err := validName(newName); err != nil {
		return "", err
	}
	p, err := w.resolve(path, false)
	if err != nil {
		return "", err
	}
	if p == w.Root() {
		return "", errors.New("cannot rename the open folder")
	}
	dst := filepath.Join(filepath.Dir(p), newName)
	if _, err := os.Lstat(dst); err == nil {
		return "", fmt.Errorf("%q already exists", newName)
	}
	return dst, os.Rename(p, dst)
}

func (w *Workspace) Move(path, destDir string) (string, error) {
	p, err := w.resolve(path, false)
	if err != nil {
		return "", err
	}
	d, err := w.resolve(destDir, false)
	if err != nil {
		return "", err
	}
	if p == w.Root() {
		return "", errors.New("cannot move the open folder")
	}
	if within(p, d) {
		return "", errors.New("cannot move a folder into itself")
	}
	dst := filepath.Join(d, filepath.Base(p))
	if dst == p {
		return p, nil
	}
	if _, err := os.Lstat(dst); err == nil {
		return "", fmt.Errorf("%q already exists in the destination", filepath.Base(p))
	}
	return dst, os.Rename(p, dst)
}

func (w *Workspace) Duplicate(path string) (string, error) {
	p, err := w.resolve(path, false)
	if err != nil {
		return "", err
	}
	if p == w.Root() {
		return "", errors.New("cannot duplicate the open folder")
	}
	ext := filepath.Ext(p)
	base := strings.TrimSuffix(filepath.Base(p), ext)
	if st, err := os.Stat(p); err == nil && st.IsDir() {
		ext, base = "", filepath.Base(p)
	}
	dst := ""
	for i := 1; ; i++ {
		suffix := " copy"
		if i > 1 {
			suffix = fmt.Sprintf(" copy %d", i)
		}
		dst = filepath.Join(filepath.Dir(p), base+suffix+ext)
		if _, err := os.Lstat(dst); errors.Is(err, fs.ErrNotExist) {
			break
		}
	}
	return dst, copyTree(p, dst)
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(p string, de fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		switch {
		case de.IsDir():
			return os.MkdirAll(target, 0o755)
		case de.Type().IsRegular():
			in, err := os.Open(p)
			if err != nil {
				return err
			}
			defer in.Close()
			out, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, in); err != nil {
				out.Close()
				return err
			}
			return out.Close()
		}
		return nil // symlinks and specials are not copied
	})
}

// Trash moves the entry to the system trash (recoverable).
func (w *Workspace) Trash(path string) error {
	p, err := w.resolve(path, false)
	if err != nil {
		return err
	}
	if p == w.Root() {
		return errors.New("cannot delete the open folder")
	}
	return wastebasket.Trash(p)
}
