package main

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"data-clutch/internal/conn"
	"data-clutch/internal/duck"
	"data-clutch/internal/pg"
	"data-clutch/internal/redisx"
	"data-clutch/internal/result"
)

func (a *App) track(queryID string) (context.Context, func()) {
	var ctx context.Context
	var cancel context.CancelFunc
	if t := a.store.Settings().Prefs.TimeoutSec; t > 0 {
		ctx, cancel = context.WithTimeout(a.ctx, time.Duration(t)*time.Second)
	} else {
		ctx, cancel = context.WithCancel(a.ctx)
	}
	a.mu.Lock()
	a.running[queryID] = cancel
	a.mu.Unlock()
	return ctx, func() {
		a.mu.Lock()
		delete(a.running, queryID)
		a.mu.Unlock()
		cancel()
	}
}

// CancelQuery stops a running or queued query without touching the connection.
func (a *App) CancelQuery(queryID string) {
	a.mu.Lock()
	cancel := a.running[queryID]
	a.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

func (a *App) session(id string) (*conn.Session, error) {
	s, ok := a.mgr.Session(id)
	if !ok {
		return nil, errors.New("not connected: connect first")
	}
	return s, nil
}

// RunQuery runs one statement (SQL for Postgres, a command line for Redis)
// through the connection's single session.
func (a *App) RunQuery(connID, queryID, sql string, limit int) (*result.Result, error) {
	s, err := a.session(connID)
	if err != nil {
		return nil, err
	}
	cfg := s.Config()
	ctx, done := a.track(queryID)
	defer done()
	var res *result.Result
	err = s.Do(ctx, func(ctx context.Context, h conn.Handle) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var err error
		switch hh := h.(type) {
		case *pg.Handle:
			res, err = hh.Query(ctx, sql, cfg.ReadOnly, limit)
		case *redisx.Handle:
			// go-redis drops its connection on cancel; commands are short, so don't pass the cancel.
			res, err = hh.Exec(context.WithoutCancel(ctx), sql, limit)
		default:
			err = fmt.Errorf("unsupported connection")
		}
		return err
	})
	return res, err
}

type SaveInfo struct {
	Table string `json:"table"`
	Rows  int64  `json:"rows"`
}

// SaveQueryToDuck re-runs the statement and streams the complete result (not
// just the visible page) into a DuckDB table. mode: create | replace | append.
func (a *App) SaveQueryToDuck(connID, queryID, sql, table, mode string) (*SaveInfo, error) {
	s, err := a.session(connID)
	if err != nil {
		return nil, err
	}
	cfg := s.Config()
	ctx, done := a.track(queryID)
	defer done()
	var info *SaveInfo
	err = s.Do(ctx, func(ctx context.Context, h conn.Handle) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		switch hh := h.(type) {
		case *pg.Handle:
			var w *duck.Writer
			var types []string
			_, err := hh.Stream(ctx, sql, cfg.ReadOnly,
				func(cols []result.Col, _ []uint32) error {
					names := make([]string, len(cols))
					types = make([]string, len(cols))
					for i, c := range cols {
						names[i], types[i] = c.Name, duck.PGType(c.Type)
					}
					var err error
					w, err = a.duck.Begin(ctx, table, mode, names, types)
					return err
				},
				func(row []any) error {
					for i := range row {
						row[i] = duck.Coerce(row[i], types[i])
					}
					return w.Append(row)
				})
			if err != nil {
				if w != nil {
					w.Rollback()
				}
				return err
			}
			if w == nil {
				return errors.New("statement returned no rows; nothing to save")
			}
			n, err := w.Commit(cfg.Name, string(cfg.Kind), sql)
			if err != nil {
				return err
			}
			info = &SaveInfo{Table: duck.SanitizeName(table), Rows: n}
			return nil
		case *redisx.Handle:
			res, err := hh.Exec(context.WithoutCancel(ctx), sql, 100000)
			if err != nil {
				return err
			}
			names := make([]string, len(res.Columns))
			types := make([]string, len(res.Columns))
			for i, c := range res.Columns {
				names[i], types[i] = c.Name, "VARCHAR"
			}
			w, err := a.duck.Begin(ctx, table, mode, names, types)
			if err != nil {
				return err
			}
			for _, row := range res.Rows {
				for i := range row {
					row[i] = duck.Coerce(row[i], "VARCHAR")
				}
				if err := w.Append(row); err != nil {
					w.Rollback()
					return err
				}
			}
			n, err := w.Commit(cfg.Name, string(cfg.Kind), sql)
			if err != nil {
				return err
			}
			info = &SaveInfo{Table: duck.SanitizeName(table), Rows: n}
			return nil
		}
		return errors.New("unsupported connection")
	})
	return info, err
}

type RedisPage struct {
	Keys   []redisx.Key `json:"keys"`
	Cursor string       `json:"cursor"` // "0" when the scan is complete
	DBSize int64        `json:"dbSize"`
}

func (a *App) RedisScan(connID, match, cursor string, count int64) (*RedisPage, error) {
	s, err := a.session(connID)
	if err != nil {
		return nil, err
	}
	cur, _ := strconv.ParseUint(cursor, 10, 64)
	if count <= 0 {
		count = 1000
	}
	var page *redisx.KeyPage
	err = s.Do(a.ctx, func(ctx context.Context, h conn.Handle) error {
		rh, ok := h.(*redisx.Handle)
		if !ok {
			return errors.New("not a redis connection")
		}
		var err error
		page, err = rh.Scan(ctx, match, cur, count)
		return err
	})
	if err != nil {
		return nil, err
	}
	return &RedisPage{Keys: page.Keys, Cursor: strconv.FormatUint(page.Cursor, 10), DBSize: page.DBSize}, nil
}

// ---- local DuckDB ----

func (a *App) DuckTables() ([]duck.TableInfo, error) { return a.duck.Tables(a.ctx) }

func (a *App) DuckQuery(queryID, sql string, limit int) (*result.Result, error) {
	ctx, done := a.track(queryID)
	defer done()
	return a.duck.Query(ctx, sql, limit)
}

func (a *App) DuckDrop(name string) error { return a.duck.Drop(a.ctx, name) }
