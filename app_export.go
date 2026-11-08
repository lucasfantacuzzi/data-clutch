package main

import (
	"bufio"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"data-clutch/internal/conn"
	"data-clutch/internal/pg"
	"data-clutch/internal/redisx"
	"data-clutch/internal/result"
)

var csvFilter = []runtime.FileFilter{{DisplayName: "CSV (*.csv)", Pattern: "*.csv"}}

type ExportInfo struct {
	Path string `json:"path"` // empty when the user cancelled the dialog
	Rows int64  `json:"rows"`
	// Truncated is true when the server-side row cap cut the export short.
	Truncated bool `json:"truncated,omitempty"`
}

func csvCell(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case []byte:
		return string(x)
	case map[string]any, []any:
		b, _ := json.Marshal(x)
		return string(b)
	default:
		return fmt.Sprint(x)
	}
}

// csvOut writes a CSV to a temp file next to the target and renames on success,
// so a failed or cancelled export never leaves a half-written file behind.
type csvOut struct {
	f    *os.File
	bw   *bufio.Writer
	w    *csv.Writer
	path string
	rows int64
}

func newCSV(path string) (*csvOut, error) {
	f, err := os.CreateTemp(filepath.Dir(path), ".export-*")
	if err != nil {
		return nil, err
	}
	bw := bufio.NewWriterSize(f, 1<<16)
	return &csvOut{f: f, bw: bw, w: csv.NewWriter(bw), path: path}, nil
}

func (c *csvOut) header(cols []result.Col) error {
	names := make([]string, len(cols))
	for i, col := range cols {
		names[i] = col.Name
	}
	return c.w.Write(names)
}

func (c *csvOut) row(vals []any) error {
	rec := make([]string, len(vals))
	for i, v := range vals {
		rec[i] = csvCell(v)
	}
	c.rows++
	return c.w.Write(rec)
}

func (c *csvOut) finish(err error) error {
	if err == nil {
		c.w.Flush()
		err = c.w.Error()
	}
	if err == nil {
		err = c.bw.Flush()
	}
	if cerr := c.f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(c.f.Name(), c.path)
	}
	if err != nil {
		_ = os.Remove(c.f.Name())
	}
	return err
}

func (a *App) askCSVPath(suggested string) (string, error) {
	if suggested == "" {
		suggested = "result.csv"
	}
	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{Title: "Export CSV", DefaultFilename: suggested, DefaultDirectory: a.ws.Root(), Filters: csvFilter})
}

// ExportLoaded writes the rows already on screen.
func (a *App) ExportLoaded(columns []string, rows [][]any, suggested string) (*ExportInfo, error) {
	path, err := a.askCSVPath(suggested)
	if err != nil || path == "" {
		return &ExportInfo{}, err
	}
	out, err := newCSV(path)
	if err != nil {
		return nil, err
	}
	cols := make([]result.Col, len(columns))
	for i, n := range columns {
		cols[i].Name = n
	}
	err = out.header(cols)
	for _, r := range rows {
		if err != nil {
			break
		}
		err = out.row(r)
	}
	if err = out.finish(err); err != nil {
		return nil, err
	}
	return &ExportInfo{Path: path, Rows: out.rows}, nil
}

// ExportFull re-runs the statement and streams every row into the file. It goes
// through the connection's own queue, so a single-session server stays safe, and
// CancelQuery(queryID) aborts it.
func (a *App) ExportFull(connID, queryID, sql, suggested string) (*ExportInfo, error) {
	path, err := a.askCSVPath(suggested)
	if err != nil || path == "" {
		return &ExportInfo{}, err
	}
	ctx, done := a.track(queryID)
	defer done()

	if connID == "" { // local DuckDB
		res, err := a.duck.Query(ctx, sql, 5_000_000)
		if err != nil {
			return nil, err
		}
		return writeResult(path, res)
	}

	s, err := a.session(connID)
	if err != nil {
		return nil, err
	}
	cfg := s.Config()
	var info *ExportInfo
	err = s.Do(ctx, func(ctx context.Context, h conn.Handle) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		switch hh := h.(type) {
		case *pg.Handle:
			out, err := newCSV(path)
			if err != nil {
				return err
			}
			_, err = hh.Stream(ctx, sql, cfg.ReadOnly,
				func(cols []result.Col, _ []uint32) error { return out.header(cols) },
				out.row)
			if err = out.finish(err); err != nil {
				return err
			}
			info = &ExportInfo{Path: path, Rows: out.rows}
			return nil
		case *redisx.Handle:
			res, err := hh.Exec(context.WithoutCancel(ctx), sql, 100000)
			if err != nil {
				return err
			}
			info, err = writeResult(path, res)
			return err
		}
		return errors.New("unsupported connection")
	})
	return info, err
}

func writeResult(path string, res *result.Result) (*ExportInfo, error) {
	out, err := newCSV(path)
	if err != nil {
		return nil, err
	}
	err = out.header(res.Columns)
	for _, r := range res.Rows {
		if err != nil {
			break
		}
		err = out.row(r)
	}
	if err = out.finish(err); err != nil {
		return nil, err
	}
	return &ExportInfo{Path: path, Rows: out.rows, Truncated: res.Truncated}, nil
}
