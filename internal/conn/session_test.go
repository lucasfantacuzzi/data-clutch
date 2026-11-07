package conn

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type fakeDriver struct {
	open, maxOpen, dials atomic.Int32
	failNext             atomic.Int32
	mu                   sync.Mutex
	handles              []*fakeHandle
}

type fakeHandle struct {
	d      *fakeDriver
	closed atomic.Bool
	dead   atomic.Bool
}

var errDead = errors.New("conn dead")

func (d *fakeDriver) Dial(ctx context.Context, cfg Config) (Handle, error) {
	d.dials.Add(1)
	if d.failNext.Load() > 0 {
		d.failNext.Add(-1)
		return nil, errors.New("server still holds old session")
	}
	n := d.open.Add(1)
	for {
		m := d.maxOpen.Load()
		if n <= m || d.maxOpen.CompareAndSwap(m, n) {
			break
		}
	}
	h := &fakeHandle{d: d}
	d.mu.Lock()
	d.handles = append(d.handles, h)
	d.mu.Unlock()
	return h, nil
}

func (h *fakeHandle) Ping(context.Context) error {
	if h.dead.Load() {
		return errDead
	}
	return nil
}
func (h *fakeHandle) Close() error {
	if h.closed.CompareAndSwap(false, true) {
		h.d.open.Add(-1)
	}
	return nil
}
func (h *fakeHandle) ServerVersion() string    { return "fake 1" }
func (h *fakeHandle) IsConnErr(err error) bool { return errors.Is(err, errDead) }

func testManager(d *fakeDriver) *Manager {
	return NewManager(map[Kind]Driver{Postgres: d}, Options{BackoffMin: 5 * time.Millisecond, BackoffMax: 20 * time.Millisecond, PingInterval: 10 * time.Millisecond}, nil)
}

func waitState(t *testing.T, s *Session, want State) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if s.Status().State == want {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("state %s, want %s", s.Status().State, want)
}

var cfg = Config{ID: "a", Name: "a", Kind: Postgres, Host: "h", Port: 5432, User: "u", Database: "d"}

func TestConcurrentJobsUseOneConnection(t *testing.T) {
	d := &fakeDriver{}
	m := testManager(d)
	defer m.CloseAll()
	if err := m.Connect(cfg); err != nil {
		t.Fatal(err)
	}
	s, _ := m.Session("a")
	waitState(t, s, StateReady)
	var wg sync.WaitGroup
	var inJob atomic.Int32
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := s.Do(context.Background(), func(ctx context.Context, h Handle) error {
				if inJob.Add(1) != 1 {
					t.Error("jobs overlapped")
				}
				time.Sleep(time.Millisecond)
				inJob.Add(-1)
				return nil
			})
			if err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if d.maxOpen.Load() != 1 {
		t.Fatalf("max open connections = %d", d.maxOpen.Load())
	}
}

func TestReconnectNeverOverlaps(t *testing.T) {
	d := &fakeDriver{}
	m := testManager(d)
	defer m.CloseAll()
	m.Connect(cfg)
	s, _ := m.Session("a")
	waitState(t, s, StateReady)

	d.failNext.Store(3)
	d.handles[0].dead.Store(true)
	// the ping notices the dead connection and the session reconnects after failed attempts
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && d.dials.Load() < 5 {
		time.Sleep(5 * time.Millisecond)
	}
	waitState(t, s, StateReady)
	if d.maxOpen.Load() != 1 {
		t.Fatalf("max open connections = %d", d.maxOpen.Load())
	}
	if d.dials.Load() != 5 {
		t.Fatalf("dials = %d, want 5 (1 initial + 3 failed + 1 ok)", d.dials.Load())
	}
}

func TestConnErrInJobTriggersReconnect(t *testing.T) {
	d := &fakeDriver{}
	m := testManager(d)
	defer m.CloseAll()
	m.Connect(cfg)
	s, _ := m.Session("a")
	waitState(t, s, StateReady)
	err := s.Do(context.Background(), func(context.Context, Handle) error { return errDead })
	if !errors.Is(err, errDead) {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) && d.dials.Load() < 2 {
		time.Sleep(2 * time.Millisecond)
	}
	waitState(t, s, StateReady)
	if d.maxOpen.Load() != 1 {
		t.Fatalf("max open = %d", d.maxOpen.Load())
	}
}

func TestConnectTwiceAndSameEndpoint(t *testing.T) {
	d := &fakeDriver{}
	m := testManager(d)
	defer m.CloseAll()
	m.Connect(cfg)
	if err := m.Connect(cfg); err != nil {
		t.Fatal(err)
	}
	other := cfg
	other.ID = "b"
	if err := m.Connect(other); err == nil {
		t.Fatal("second config for same endpoint must be rejected")
	}
}

func TestTestWithoutSessionOpensAndClosesOne(t *testing.T) {
	d := &fakeDriver{}
	m := testManager(d)
	r := m.Test(context.Background(), cfg)
	if !r.OK || r.Reused {
		t.Fatalf("%+v", r)
	}
	if d.dials.Load() != 1 || d.open.Load() != 0 {
		t.Fatalf("dials=%d open=%d", d.dials.Load(), d.open.Load())
	}
}

func TestTestWithSessionDoesNotDial(t *testing.T) {
	d := &fakeDriver{}
	m := testManager(d)
	defer m.CloseAll()
	m.Connect(cfg)
	s, _ := m.Session("a")
	waitState(t, s, StateReady)
	unsaved := cfg
	unsaved.ID = "" // same endpoint, unsaved form
	r := m.Test(context.Background(), unsaved)
	if !r.OK || !r.Reused {
		t.Fatalf("%+v", r)
	}
	if d.dials.Load() != 1 {
		t.Fatalf("dials=%d", d.dials.Load())
	}
}

func TestCloseClosesConnection(t *testing.T) {
	d := &fakeDriver{}
	m := testManager(d)
	m.Connect(cfg)
	s, _ := m.Session("a")
	waitState(t, s, StateReady)
	m.Disconnect("a")
	if d.open.Load() != 0 {
		t.Fatal("connection leaked")
	}
}
