package conn

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// endpointLocks serializes dials per server endpoint (session connects and tests).
type endpointLocks struct {
	mu sync.Mutex
	m  map[string]*sync.Mutex
}

func (e *endpointLocks) lock(key string) func() {
	e.mu.Lock()
	if e.m == nil {
		e.m = map[string]*sync.Mutex{}
	}
	l := e.m[key]
	if l == nil {
		l = &sync.Mutex{}
		e.m[key] = l
	}
	e.mu.Unlock()
	l.Lock()
	return l.Unlock
}

type Manager struct {
	drivers map[Kind]Driver
	opts    Options
	notify  func(Status)
	locks   endpointLocks

	mu       sync.Mutex
	sessions map[string]*Session
}

func NewManager(drivers map[Kind]Driver, opts Options, notify func(Status)) *Manager {
	return &Manager{drivers: drivers, opts: opts, notify: notify, sessions: map[string]*Session{}}
}

// Connect starts the single session for cfg. Calling it again while a session
// exists is a no-op, so a connection can never be doubled.
func (m *Manager) Connect(cfg Config) error {
	d, ok := m.drivers[cfg.Kind]
	if !ok {
		return fmt.Errorf("unsupported kind %q", cfg.Kind)
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.sessions[cfg.ID]; ok {
		return nil
	}
	for _, o := range m.sessions {
		if o.cfg.Endpoint() == cfg.Endpoint() {
			return fmt.Errorf("%q already has an open session to this server", o.cfg.Name)
		}
	}
	m.sessions[cfg.ID] = newSession(cfg, d, m.opts, &m.locks, m.notify)
	return nil
}

// sessionFor finds the live session for cfg by ID or, failing that, by server endpoint.
func (m *Manager) sessionFor(cfg Config) (*Session, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.sessions[cfg.ID]; ok && cfg.ID != "" {
		return s, true
	}
	for _, s := range m.sessions {
		if s.cfg.Endpoint() == cfg.Endpoint() {
			return s, true
		}
	}
	return nil, false
}

func (m *Manager) Session(id string) (*Session, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	return s, ok
}

func (m *Manager) Disconnect(id string) {
	m.mu.Lock()
	s, ok := m.sessions[id]
	delete(m.sessions, id)
	m.mu.Unlock()
	if ok {
		s.Close()
	}
}

func (m *Manager) Statuses() []Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Status, 0, len(m.sessions))
	for _, s := range m.sessions {
		out = append(out, s.Status())
	}
	return out
}

func (m *Manager) CloseAll() {
	m.mu.Lock()
	ss := m.sessions
	m.sessions = map[string]*Session{}
	m.mu.Unlock()
	for _, s := range ss {
		s.Close()
	}
}

type TestResult struct {
	OK        bool   `json:"ok"`
	Message   string `json:"message"`
	Version   string `json:"version,omitempty"`
	LatencyMs int64  `json:"latencyMs"`
	Reused    bool   `json:"reused"` // answered through the already-open session
}

// Test validates cfg without ever creating a second concurrent connection.
// With a live session it pings through that session; otherwise it dials once
// under the endpoint lock, pings and closes immediately.
func (m *Manager) Test(ctx context.Context, cfg Config) TestResult {
	d, ok := m.drivers[cfg.Kind]
	if !ok {
		return TestResult{Message: fmt.Sprintf("unsupported kind %q", cfg.Kind)}
	}
	start := time.Now()

	if s, ok := m.sessionFor(cfg); ok {
		st := s.Status().State
		if st == StateReady || st == StateBusy {
			var ver string
			err := s.Do(ctx, func(c context.Context, h Handle) error {
				ver = h.ServerVersion()
				return h.Ping(c)
			})
			if err != nil {
				return TestResult{Message: err.Error(), Reused: true}
			}
			return TestResult{OK: true, Message: "Connection already active (tested through the open session)", Version: ver, LatencyMs: time.Since(start).Milliseconds(), Reused: true}
		}
		return TestResult{Message: "Connection already active but not ready (" + string(st) + "); not opening a second one", Reused: true}
	}

	unlock := m.locks.lock(cfg.Endpoint())
	defer unlock()
	cctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	h, err := d.Dial(cctx, cfg)
	if err != nil {
		return TestResult{Message: err.Error()}
	}
	defer h.Close()
	if err := h.Ping(cctx); err != nil {
		return TestResult{Message: err.Error()}
	}
	return TestResult{OK: true, Message: "Connection successful", Version: h.ServerVersion(), LatencyMs: time.Since(start).Milliseconds()}
}
