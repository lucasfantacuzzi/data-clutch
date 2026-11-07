// Package pg is the PostgreSQL driver: one pgx.Conn, never a pool.
package pg

import (
	"context"
	"errors"
	"net"
	"net/url"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"data-clutch/internal/conn"
)

type Driver struct{}

func (Driver) Dial(ctx context.Context, cfg conn.Config) (conn.Handle, error) {
	pc, err := pgx.ParseConfig(connString(cfg))
	if err != nil {
		return nil, errors.New("invalid connection settings")
	}
	pc.RuntimeParams["application_name"] = "data-clutch"
	if cfg.ReadOnly {
		pc.RuntimeParams["default_transaction_read_only"] = "on"
	}
	d := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 15 * time.Second}
	pc.DialFunc = d.DialContext
	c, err := pgx.ConnectConfig(ctx, pc)
	if err != nil {
		return nil, err
	}
	h := &Handle{conn: c}
	var v string
	if err := c.QueryRow(ctx, "show server_version").Scan(&v); err == nil {
		h.version = "PostgreSQL " + v
	}
	return h, nil
}

func connString(cfg conn.Config) string {
	port := cfg.Port
	if port == 0 {
		port = 5432
	}
	u := url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(cfg.User, cfg.Password),
		Host:   net.JoinHostPort(cfg.Host, strconv.Itoa(port)),
		Path:   "/" + cfg.Database,
	}
	q := url.Values{}
	ssl := cfg.SSLMode
	if ssl == "" {
		ssl = "prefer"
	}
	q.Set("sslmode", ssl)
	u.RawQuery = q.Encode()
	return u.String()
}

// Handle wraps the only connection. Methods other than Schema must run on the
// owning session goroutine (via Session.Do); Schema is safe from anywhere.
type Handle struct {
	conn    *pgx.Conn
	version string

	mu     sync.RWMutex
	schema *Schema
}

func (h *Handle) Conn() *pgx.Conn                { return h.conn }
func (h *Handle) ServerVersion() string          { return h.version }
func (h *Handle) Ping(ctx context.Context) error { return h.conn.Ping(ctx) }
func (h *Handle) Close() error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return h.conn.Close(ctx)
}

func (h *Handle) IsConnErr(err error) bool {
	if err == nil {
		return false
	}
	if h.conn.IsClosed() {
		return true
	}
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		return false // server answered: connection is fine
	}
	return pgconn.SafeToRetry(err) || errors.Is(err, net.ErrClosed) || isNetErr(err)
}

func isNetErr(err error) bool {
	var ne net.Error
	return errors.As(err, &ne)
}

// Refresh re-reads the catalog on the same connection.
func (h *Handle) Refresh(ctx context.Context) error {
	s, err := introspect(ctx, h.conn)
	if err != nil {
		return err
	}
	h.mu.Lock()
	h.schema = s
	h.mu.Unlock()
	return nil
}

func (h *Handle) Schema() *Schema {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.schema
}
