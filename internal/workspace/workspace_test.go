package workspace

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func open(t *testing.T) (*Workspace, string) {
	t.Helper()
	root := t.TempDir()
	real, _ := filepath.EvalSymlinks(root)
	w := New()
	if err := w.SetRoot(real, nil); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(w.Close)
	return w, real
}

func TestRejectsPathsOutsideRoot(t *testing.T) {
	w, root := open(t)
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret.sql")
	os.WriteFile(secret, []byte("x"), 0o644)

	for name, fn := range map[string]func() error{
		"read abs": func() error { _, err := w.Read(secret); return err },
		"read dotdot": func() error {
			_, err := w.Read(filepath.Join(root, "..", filepath.Base(outside), "secret.sql"))
			return err
		},
		"write outside":  func() error { return w.Write(filepath.Join(outside, "new.sql"), "x") },
		"list outside":   func() error { _, err := w.List(outside); return err },
		"trash outside":  func() error { return w.Trash(secret) },
		"create outside": func() error { _, err := w.Create(outside, "a.sql", false); return err },
		"relative path":  func() error { _, err := w.Read("a.sql"); return err },
	} {
		if err := fn(); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestRejectsSymlinkEscape(t *testing.T) {
	w, root := open(t)
	outside := t.TempDir()
	os.WriteFile(filepath.Join(outside, "secret.sql"), []byte("x"), 0o644)
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Skip("symlinks unavailable:", err)
	}
	if _, err := w.Read(filepath.Join(root, "link", "secret.sql")); err == nil {
		t.Fatal("read through an escaping symlink must fail")
	}
	if err := w.Write(filepath.Join(root, "link", "new.sql"), "x"); err == nil {
		t.Fatal("write through an escaping symlink must fail")
	}
	es, err := w.List(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range es {
		if e.Name == "link" {
			t.Fatal("escaping symlink must not be listed")
		}
	}
}

func TestApprovedFileOutsideRoot(t *testing.T) {
	w, _ := open(t)
	f := filepath.Join(t.TempDir(), "picked.sql")
	if err := w.Write(f, "x"); err == nil {
		t.Fatal("unapproved write should fail")
	}
	w.Approve(f)
	if err := w.Write(f, "select 1"); err != nil {
		t.Fatal(err)
	}
	if got, _ := w.Read(f); got != "select 1" {
		t.Fatalf("got %q", got)
	}
	if err := w.Trash(f); err == nil {
		t.Fatal("approval covers read/write only, not trash")
	}
}

func TestFileOperations(t *testing.T) {
	w, root := open(t)
	sub, err := w.Create(root, "reports", true)
	if err != nil {
		t.Fatal(err)
	}
	f, err := w.Create(sub, "a.sql", false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Create(sub, "a.sql", false); err == nil {
		t.Fatal("duplicate create should fail")
	}
	if _, err := w.Create(sub, "../evil.sql", false); err == nil {
		t.Fatal("separator in name should fail")
	}
	if err := w.Write(f, "select 1"); err != nil {
		t.Fatal(err)
	}

	dup, err := w.Duplicate(f)
	if err != nil || filepath.Base(dup) != "a copy.sql" {
		t.Fatalf("dup=%q err=%v", dup, err)
	}
	dup2, _ := w.Duplicate(f)
	if filepath.Base(dup2) != "a copy 2.sql" {
		t.Fatalf("second dup=%q", dup2)
	}

	r, err := w.Rename(f, "b.sql")
	if err != nil || filepath.Base(r) != "b.sql" {
		t.Fatalf("rename=%q err=%v", r, err)
	}
	moved, err := w.Move(r, root)
	if err != nil || filepath.Dir(moved) != root {
		t.Fatalf("move=%q err=%v", moved, err)
	}
	if _, err := w.Move(sub, filepath.Join(sub)); err == nil {
		t.Fatal("moving a folder into itself should fail")
	}
	if got, _ := w.Read(moved); got != "select 1" {
		t.Fatalf("content lost: %q", got)
	}

	es, _ := w.List(root)
	if len(es) < 2 || !es[0].IsDir || es[0].Name != "reports" {
		t.Fatalf("dirs should sort first: %+v", es)
	}
	if _, err := w.Rename(root, "x"); err == nil {
		t.Fatal("renaming the root should fail")
	}
}

func TestListFiltersAndFiles(t *testing.T) {
	w, root := open(t)
	os.WriteFile(filepath.Join(root, "q.sql"), nil, 0o644)
	os.WriteFile(filepath.Join(root, "k.redis"), nil, 0o644)
	os.WriteFile(filepath.Join(root, "notes.txt"), nil, 0o644)
	os.Mkdir(filepath.Join(root, ".git"), 0o755)
	os.WriteFile(filepath.Join(root, ".git", "x.sql"), nil, 0o644)
	es, _ := w.List(root)
	if len(es) != 2 {
		t.Fatalf("want q.sql + k.redis, got %+v", es)
	}
	fs, _ := w.Files(100)
	if len(fs) != 2 {
		t.Fatalf("quick-open should skip .git and non-scripts: %+v", fs)
	}
}

func TestTrashRemovesFile(t *testing.T) {
	data := t.TempDir()
	t.Setenv("XDG_DATA_HOME", data)
	t.Setenv("HOME", data)
	w, root := open(t)
	f := filepath.Join(root, "gone.sql")
	os.WriteFile(f, []byte("x"), 0o644)
	if err := w.Trash(f); err != nil {
		t.Skip("system trash unavailable here:", err)
	}
	if _, err := os.Stat(f); !os.IsNotExist(err) {
		t.Fatal("file should be gone from the folder")
	}
}

func TestWatcherReportsChanges(t *testing.T) {
	root := t.TempDir()
	real, _ := filepath.EvalSymlinks(root)
	got := make(chan []string, 4)
	w := New()
	if err := w.SetRoot(real, func(p []string) { got <- p }); err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	if w.watch == nil {
		t.Skip("file watching unavailable")
	}
	os.WriteFile(filepath.Join(real, "n.sql"), []byte("x"), 0o644)
	select {
	case p := <-got:
		if len(p) == 0 {
			t.Fatal("empty change set")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no change event")
	}
}
