package conn

import (
	"context"
	"math/rand"
	"sync"
	"time"
)

type Options struct {
	BackoffMin   time.Duration
	BackoffMax   time.Duration
	PingInterval time.Duration
	DialTimeout  time.Duration
}

func (o Options) withDefaults() Options {
	if o.BackoffMin == 0 {
		o.BackoffMin = 2 * time.Second
	}
	if o.BackoffMax == 0 {
		o.BackoffMax = 60 * time.Second
	}
	if o.PingInterval == 0 {
		o.PingInterval = 30 * time.Second
	}
	if o.DialTimeout == 0 {
		o.DialTimeout = 15 * time.Second
	}
	return o
}

type job struct {
	ctx  context.Context
	fn   func(context.Context, Handle) error
	done chan error
}

// Session owns exactly one connection to one server. A single goroutine dials,
// serves jobs in FIFO order, pings when idle and reconnects with backoff, so a
// second connection can never exist.
type Session struct {
	cfg    Config
	driver Driver
	opts   Options
	locks  *endpointLocks
	notify func(Status)

	jobs   chan job
	wake   chan struct{} // "retry now"
	stop   chan struct{}
	exited chan struct{}

	mu     sync.Mutex
	status Status
}

func newSession(cfg Config, d Driver, o Options, locks *endpointLocks, notify func(Status)) *Session {
	s := &Session{
		cfg: cfg, driver: d, opts: o.withDefaults(), locks: locks, notify: notify,
		jobs:   make(chan job),
		wake:   make(chan struct{}, 1),
		stop:   make(chan struct{}),
		exited: make(chan struct{}),
		status: Status{ID: cfg.ID, State: StateConnecting},
	}
	go s.run()
	return s
}

func (s *Session) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

func (s *Session) set(st Status) {
	st.ID = s.cfg.ID
	s.mu.Lock()
	s.status = st
	s.mu.Unlock()
	if s.notify != nil {
		s.notify(st)
	}
}

// Do runs fn on the live connection, after every job queued before it.
func (s *Session) Do(ctx context.Context, fn func(context.Context, Handle) error) error {
	switch s.Status().State {
	case StateReady, StateBusy:
	case StateClosed:
		return ErrClosed
	default:
		return ErrNotReady
	}
	j := job{ctx: ctx, fn: fn, done: make(chan error, 1)}
	select {
	case s.jobs <- j:
	case <-ctx.Done():
		return ctx.Err()
	case <-s.stop:
		return ErrClosed
	}
	select {
	case err := <-j.done:
		return err
	case <-s.exited:
		return ErrClosed
	}
}

// RetryNow skips the current backoff wait. It never opens a parallel dial.
func (s *Session) RetryNow() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// Close stops the session and closes the connection before returning.
func (s *Session) Close() {
	select {
	case <-s.stop:
	default:
		close(s.stop)
	}
	<-s.exited
}

func (s *Session) run() {
	defer close(s.exited)
	defer s.set(Status{State: StateClosed})
	attempt := 0
	for {
		h, err := s.connect(&attempt)
		if h == nil {
			if err == nil {
				return // stopped
			}
			continue
		}
		attempt = 0
		if !s.serve(h) {
			return
		}
	}
}

// connect dials until it gets a ready handle. Returns (nil, nil) when stopped,
// (nil, err) after a failed attempt that was already waited out.
func (s *Session) connect(attempt *int) (Handle, error) {
	for {
		*attempt++
		state := StateConnecting
		if *attempt > 1 {
			state = StateReconnecting
		}
		s.set(Status{State: state, Attempt: *attempt})

		h, err := s.dialAndPrepare()
		if err == nil {
			return h, nil
		}
		select {
		case <-s.stop:
			return nil, nil
		default:
		}
		wait := s.backoff(*attempt)
		s.set(Status{State: StateReconnecting, Error: err.Error(), Attempt: *attempt, NextRetry: time.Now().Add(wait).UnixMilli()})
		t := time.NewTimer(wait)
		select {
		case <-t.C:
		case <-s.wake:
			t.Stop()
		case <-s.stop:
			t.Stop()
			return nil, nil
		}
	}
}

func (s *Session) dialAndPrepare() (Handle, error) {
	unlock := s.locks.lock(s.cfg.Endpoint())
	defer unlock()

	ctx, cancel := context.WithTimeout(context.Background(), s.opts.DialTimeout)
	defer cancel()
	go func() {
		select {
		case <-s.stop:
			cancel()
		case <-ctx.Done():
		}
	}()

	h, err := s.driver.Dial(ctx, s.cfg)
	if err != nil {
		return nil, err
	}
	if r, ok := h.(Refresher); ok {
		s.set(Status{State: StateIntrospecting})
		// introspection may be slow on big schemas; do not cap it with the dial timeout
		ictx, icancel := context.WithCancel(context.Background())
		go func() {
			select {
			case <-s.stop:
				icancel()
			case <-ictx.Done():
			}
		}()
		err := r.Refresh(ictx)
		icancel()
		if err != nil {
			h.Close()
			return nil, err
		}
	}
	s.set(Status{State: StateReady, Version: h.ServerVersion()})
	return h, nil
}

// serve handles jobs until the connection dies (returns true) or the session stops (false).
func (s *Session) serve(h Handle) bool {
	tick := time.NewTicker(s.opts.PingInterval)
	defer tick.Stop()
	for {
		select {
		case <-s.stop:
			h.Close()
			return false
		case <-tick.C:
			ctx, cancel := context.WithTimeout(context.Background(), s.opts.DialTimeout)
			err := h.Ping(ctx)
			cancel()
			if err != nil {
				h.Close()
				return true
			}
		case j := <-s.jobs:
			s.set(Status{State: StateBusy, Version: h.ServerVersion()})
			err := j.fn(j.ctx, h)
			j.done <- err
			if err != nil && h.IsConnErr(err) {
				h.Close()
				return true
			}
			s.set(Status{State: StateReady, Version: h.ServerVersion()})
			tick.Reset(s.opts.PingInterval)
		}
	}
}

func (s *Session) backoff(attempt int) time.Duration {
	d := s.opts.BackoffMin
	for i := 1; i < attempt && d < s.opts.BackoffMax; i++ {
		d *= 2
	}
	if d > s.opts.BackoffMax {
		d = s.opts.BackoffMax
	}
	jitter := time.Duration(rand.Int63n(int64(d)/4 + 1))
	return d - jitter
}

func (s *Session) Config() Config { return s.cfg }
