package conn

import (
	"context"
	"errors"
)

type Kind string

const (
	Postgres Kind = "postgres"
	Redis    Kind = "redis"
)

// Config describes one saved connection. Password is never written to the JSON file.
type Config struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Kind     Kind   `json:"kind"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	User     string `json:"user"`
	Password string `json:"password,omitempty"`
	Database string `json:"database"` // postgres db name, or redis db index
	SSLMode  string `json:"sslMode"`
	ReadOnly bool   `json:"readOnly"`
}

// Endpoint identifies the server a config talks to. Everything that dials the
// same endpoint is serialized, because the server accepts a single session.
func (c Config) Endpoint() string {
	return string(c.Kind) + "://" + c.User + "@" + c.Host + ":" + itoa(c.Port) + "/" + c.Database
}

type State string

const (
	StateConnecting    State = "connecting"
	StateIntrospecting State = "introspecting"
	StateReady         State = "ready"
	StateBusy          State = "busy"
	StateReconnecting  State = "reconnecting"
	StateClosed        State = "closed"
)

type Status struct {
	ID        string `json:"id"`
	State     State  `json:"state"`
	Error     string `json:"error,omitempty"`
	NextRetry int64  `json:"nextRetryMs,omitempty"` // unix ms of next attempt while reconnecting
	Attempt   int    `json:"attempt,omitempty"`
	Version   string `json:"version,omitempty"`
}

// Handle is the live connection of a driver. Only the owning Session goroutine
// ever touches it, so implementations need no locking.
type Handle interface {
	Ping(ctx context.Context) error
	Close() error
	ServerVersion() string
	// IsConnErr reports whether err means the connection itself is dead.
	IsConnErr(err error) bool
}

// Refresher is implemented by handles that cache metadata (schema introspection).
type Refresher interface {
	Refresh(ctx context.Context) error
}

type Driver interface {
	Dial(ctx context.Context, cfg Config) (Handle, error)
}

var (
	ErrNotReady = errors.New("connection is not ready")
	ErrClosed   = errors.New("connection closed")
)

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
