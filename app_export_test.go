package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"data-clutch/internal/result"
)

func TestCSVOutWritesAtomically(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "out.csv")

	out, err := newCSV(target)
	if err != nil {
		t.Fatal(err)
	}
	_ = out.header([]result.Col{{Name: "id"}, {Name: "note"}})
	_ = out.row([]any{1, "has,comma"})
	_ = out.row([]any{nil, map[string]any{"a": 1}})
	if _, err := os.Stat(target); err == nil {
		t.Fatal("target must not exist before finish")
	}
	if err := out.finish(nil); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(target)
	want := "id,note\n1,\"has,comma\"\n,\"{\"\"a\"\":1}\"\n"
	if string(b) != want {
		t.Fatalf("got %q want %q", b, want)
	}
	if out.rows != 2 {
		t.Fatalf("rows=%d", out.rows)
	}
}

func TestCSVOutFailureLeavesNothing(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "out.csv")
	out, _ := newCSV(target)
	_ = out.row([]any{1})
	if err := out.finish(errors.New("boom")); err == nil {
		t.Fatal("expected the error back")
	}
	es, _ := os.ReadDir(dir)
	if len(es) != 0 {
		t.Fatalf("leftover files: %v", es)
	}
}

func TestWriteResultReportsTruncation(t *testing.T) {
	target := filepath.Join(t.TempDir(), "out.csv")
	res := &result.Result{Columns: []result.Col{{Name: "a"}}, Rows: [][]any{{1}, {2}}, Truncated: true}
	info, err := writeResult(target, res)
	if err != nil {
		t.Fatal(err)
	}
	if !info.Truncated || info.Rows != 2 {
		t.Fatalf("got %+v", info)
	}
}
