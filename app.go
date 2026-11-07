package main

import (
	"context"
	"errors"
	"path/filepath"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"data-clutch/internal/conn"
	"data-clutch/internal/duck"
	"data-clutch/internal/mcpsrv"
	"data-clutch/internal/pg"
	"data-clutch/internal/redisx"
	"data-clutch/internal/store"
)

// App is bound to the frontend; every exported method is callable from JS.
type App struct {
	ctx   context.Context
	store *store.Store
	mgr   *conn.Manager
	duck  *duck.DB

	mu      sync.Mutex
	running map[string]context.CancelFunc // queryID -> cancel
	mcp     *mcpsrv.Server
	mcpErr  string
}

func NewApp() *App { return &App{} }

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	dir, err := store.DefaultDir()
	if err != nil {
		panic(err)
	}
	if a.store, err = store.Open(dir); err != nil {
		panic(err)
	}
	if a.duck, err = duck.Open(filepath.Join(dir, "data.duckdb")); err != nil {
		panic(err)
	}
	a.running = map[string]context.CancelFunc{}
	a.mgr = conn.NewManager(
		map[conn.Kind]conn.Driver{conn.Postgres: pg.Driver{}, conn.Redis: redisx.Driver{}},
		conn.Options{},
		func(st conn.Status) { runtime.EventsEmit(ctx, "conn:status", st) },
	)
	if st := a.store.Settings(); st.McpEnabled {
		a.startMCP(st)
	}
}

func (a *App) shutdown(ctx context.Context) {
	a.stopMCP()
	a.mgr.CloseAll()
	a.duck.Close()
}

func (a *App) ListConnections() []conn.Config { return a.store.List() }

func (a *App) SaveConnection(c conn.Config) (conn.Config, error) { return a.store.Save(c) }

func (a *App) DeleteConnection(id string) error {
	a.mgr.Disconnect(id)
	return a.store.Delete(id)
}

// TestConnection checks the form values. If the form is for a saved connection
// and the password field was left empty, the stored password is used.
func (a *App) TestConnection(c conn.Config) conn.TestResult {
	if c.Password == "" && c.ID != "" {
		if saved, ok := a.store.Get(c.ID); ok {
			c.Password = saved.Password
		}
	}
	return a.mgr.Test(a.ctx, c)
}

func (a *App) Connect(id string) error {
	c, ok := a.store.Get(id)
	if !ok {
		return errors.New("unknown connection")
	}
	return a.mgr.Connect(c)
}

func (a *App) Disconnect(id string) { a.mgr.Disconnect(id) }

func (a *App) RetryNow(id string) {
	if s, ok := a.mgr.Session(id); ok {
		s.RetryNow()
	}
}

func (a *App) ConnectionStatuses() []conn.Status { return a.mgr.Statuses() }

// GetSchema returns the cached introspection, read through the session queue.
func (a *App) GetSchema(id string) (*pg.Schema, error) {
	s, ok := a.mgr.Session(id)
	if !ok {
		return nil, conn.ErrNotReady
	}
	var out *pg.Schema
	err := s.Do(a.ctx, func(_ context.Context, h conn.Handle) error {
		if ph, ok := h.(*pg.Handle); ok {
			out = ph.Schema()
		}
		return nil
	})
	return out, err
}

// RefreshSchema re-introspects on the same connection.
func (a *App) RefreshSchema(id string) (*pg.Schema, error) {
	s, ok := a.mgr.Session(id)
	if !ok {
		return nil, conn.ErrNotReady
	}
	var out *pg.Schema
	err := s.Do(a.ctx, func(ctx context.Context, h conn.Handle) error {
		ph, ok := h.(*pg.Handle)
		if !ok {
			return nil
		}
		if err := ph.Refresh(ctx); err != nil {
			return err
		}
		out = ph.Schema()
		return nil
	})
	return out, err
}
