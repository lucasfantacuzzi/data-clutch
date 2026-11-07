package pg

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"data-clutch/internal/conn"
	"data-clutch/internal/duck"
	"data-clutch/internal/result"
)

// Needs the docker-compose postgres: CLUTCH_PG=localhost:55432 go test ./internal/pg
func testCfg(t *testing.T) conn.Config {
	addr := os.Getenv("CLUTCH_PG")
	if addr == "" {
		t.Skip("CLUTCH_PG not set")
	}
	host, port, _ := strings.Cut(addr, ":")
	p := 0
	for _, ch := range port {
		p = p*10 + int(ch-'0')
	}
	return conn.Config{ID: "t", Name: "t", Kind: conn.Postgres, Host: host, Port: p, User: "postgres", Password: "clutch", Database: "clutch", SSLMode: "disable", ReadOnly: true}
}

func TestSessionAgainstRealPostgres(t *testing.T) {
	cfg := testCfg(t)
	m := conn.NewManager(map[conn.Kind]conn.Driver{conn.Postgres: Driver{}}, conn.Options{BackoffMin: 100 * time.Millisecond, BackoffMax: 500 * time.Millisecond, PingInterval: time.Second}, nil)
	defer m.CloseAll()
	if err := m.Connect(cfg); err != nil {
		t.Fatal(err)
	}
	s, _ := m.Session("t")
	for i := 0; i < 100 && s.Status().State != conn.StateReady; i++ {
		time.Sleep(100 * time.Millisecond)
	}
	if s.Status().State != conn.StateReady {
		t.Fatalf("not ready: %+v", s.Status())
	}

	ctx := context.Background()
	// schema introspection ran before ready
	err := s.Do(ctx, func(ctx context.Context, h conn.Handle) error {
		ph := h.(*Handle)
		if ph.Schema() == nil {
			t.Error("schema not loaded before ready")
		}
		// read-only is enforced by the server
		if _, err := ph.Conn().Exec(ctx, "create table should_fail(i int)"); err == nil {
			t.Error("write succeeded on a read-only connection")
		}
		// exactly one session for this app
		var n int
		if err := ph.Conn().QueryRow(ctx, "select count(*) from pg_stat_activity where application_name='data-clutch'").Scan(&n); err != nil {
			return err
		}
		if n != 1 {
			t.Errorf("sessions = %d, want 1", n)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	// test while the session is open must reuse it
	r := m.Test(ctx, cfg)
	if !r.OK || !r.Reused {
		t.Fatalf("%+v", r)
	}

	// kill the backend from outside and expect a transparent reconnect
	adminCfg := cfg
	adminCfg.ReadOnly = false
	var pid int32
	s.Do(ctx, func(ctx context.Context, h conn.Handle) error {
		return h.(*Handle).Conn().QueryRow(ctx, "select pg_backend_pid()").Scan(&pid)
	})
	killer, err := Driver{}.Dial(ctx, adminCfg)
	if err != nil {
		t.Skipf("cannot open a 2nd admin session to kill the first (server reserved slots): %v", err)
	}
	killer.(*Handle).Conn().Exec(ctx, "select pg_terminate_backend($1)", pid)
	killer.Close()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if s.Status().State == conn.StateReady {
			if err := s.Do(ctx, func(ctx context.Context, h conn.Handle) error { return h.Ping(ctx) }); err == nil {
				return
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatalf("did not recover: %+v", s.Status())
}

func TestQueryAndSaveToDuck(t *testing.T) {
	cfg := testCfg(t)
	ctx := context.Background()
	hh, err := Driver{}.Dial(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer hh.Close()
	h := hh.(*Handle)

	const q = `select 1::int4 a, 2::int8 b, 'x'::text c, now() d, 1.25::numeric e, gen_random_uuid() f,
	  '{"k":[1,2]}'::jsonb g, array[1,2,3] h, '\xdead'::bytea i, null::text j, current_date k, true l, 9007199254740993::int8 m`
	r, err := h.Query(ctx, q, true, 10)
	if err != nil || len(r.Rows) != 1 || len(r.Columns) != 13 {
		t.Fatalf("%v %+v", err, r)
	}
	if r.Columns[3].Type != "timestamptz" || r.Rows[0][12] != "9007199254740993" {
		t.Fatalf("%+v %v", r.Columns[3], r.Rows[0][12])
	}

	// read-only: write statements are rejected, nothing is created
	if _, err := h.Query(ctx, "create table nope(i int)", true, 10); err == nil {
		t.Fatal("write allowed")
	}

	d, err := duck.Open(filepath.Join(t.TempDir(), "x.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	var w *duck.Writer
	var types []string
	_, err = h.Stream(ctx, q, true, func(cols []result.Col, _ []uint32) error {
		names := make([]string, len(cols))
		types = make([]string, len(cols))
		for i, c := range cols {
			names[i], types[i] = c.Name, duck.PGType(c.Type)
		}
		var err error
		w, err = d.Begin(ctx, "t", duck.ModeCreate, names, types)
		return err
	}, func(row []any) error {
		for i := range row {
			row[i] = duck.Coerce(row[i], types[i])
		}
		return w.Append(row)
	})
	if err != nil {
		t.Fatal(err)
	}
	if n, err := w.Commit("c", "postgres", q); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	out, err := d.Query(ctx, "select a, d, e, g, h, k from t", 5)
	if err != nil || len(out.Rows) != 1 {
		t.Fatalf("%v %+v", err, out)
	}
	t.Logf("%v", out.Rows[0])

	// cancel: the connection must survive a cancelled long query
	cctx, cancel := context.WithCancel(ctx)
	go func() { time.Sleep(300 * time.Millisecond); cancel() }()
	_, err = h.Query(cctx, "select pg_sleep(10)", true, 10)
	if err == nil || !strings.Contains(err.Error(), "cancel") {
		t.Fatalf("expected cancel error, got %v", err)
	}
	if h.Conn().IsClosed() {
		t.Fatal("connection was closed by cancel")
	}
	if _, err := h.Query(ctx, "select 1", true, 1); err != nil {
		t.Fatalf("connection unusable after cancel: %v", err)
	}
}
