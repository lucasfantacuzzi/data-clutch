// Package redisx is the Redis driver: one connection (pool of 1), no retries of its own.
package redisx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"data-clutch/internal/conn"
	"data-clutch/internal/result"
)

type Driver struct{}

func (Driver) Dial(ctx context.Context, cfg conn.Config) (conn.Handle, error) {
	port := cfg.Port
	if port == 0 {
		port = 6379
	}
	db, _ := strconv.Atoi(cfg.Database)
	d := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 15 * time.Second}
	opt := &redis.Options{
		Addr:            net.JoinHostPort(cfg.Host, strconv.Itoa(port)),
		Username:        cfg.User,
		Password:        cfg.Password,
		DB:              db,
		Protocol:        2,
		PoolSize:        1, // never a second connection
		MinIdleConns:    0,
		MaxRetries:      -1, // the session owns reconnection
		ConnMaxIdleTime: -1,
		DialTimeout:     10 * time.Second,
		Dialer:          d.DialContext,
		DisableIdentity: true,
	}
	c := redis.NewClient(opt)
	if err := c.Ping(ctx).Err(); err != nil {
		c.Close()
		return nil, err
	}
	h := &Handle{c: c, readOnly: cfg.ReadOnly}
	if info, err := c.Info(ctx, "server").Result(); err == nil {
		for _, l := range strings.Split(info, "\n") {
			if v, ok := strings.CutPrefix(strings.TrimSpace(l), "redis_version:"); ok {
				h.version = "Redis " + v
			}
		}
	}
	return h, nil
}

type Handle struct {
	c        *redis.Client
	version  string
	readOnly bool
	readCmds map[string]bool
}

func (h *Handle) Ping(ctx context.Context) error { return h.c.Ping(ctx).Err() }
func (h *Handle) Close() error                   { return h.c.Close() }
func (h *Handle) ServerVersion() string          { return h.version }

func (h *Handle) IsConnErr(err error) bool {
	if err == nil {
		return false
	}
	var re redis.Error
	if errors.As(err, &re) {
		return false
	}
	var ne net.Error
	return errors.Is(err, io.EOF) || errors.Is(err, redis.ErrClosed) || errors.Is(err, io.ErrUnexpectedEOF) || errors.As(err, &ne)
}

// Refresh loads the command table; its "readonly" flags drive the read-only guard.
func (h *Handle) Refresh(ctx context.Context) error {
	cmds, err := h.c.Command(ctx).Result()
	if err != nil {
		return err
	}
	h.readCmds = make(map[string]bool, len(cmds))
	for name, info := range cmds {
		h.readCmds[strings.ToLower(name)] = info.ReadOnly
	}
	return nil
}

type Key struct {
	Key  string `json:"key"`
	Type string `json:"type"`
	TTL  int64  `json:"ttl"` // seconds, -1 no expiry, -2 gone
}

type KeyPage struct {
	Keys   []Key  `json:"keys"`
	Cursor uint64 `json:"cursor"`
	DBSize int64  `json:"dbSize"`
}

// Scan returns one SCAN page with type and TTL for each key.
func (h *Handle) Scan(ctx context.Context, match string, cursor uint64, count int64) (*KeyPage, error) {
	if match == "" {
		match = "*"
	}
	keys, next, err := h.c.Scan(ctx, cursor, match, count).Result()
	if err != nil {
		return nil, err
	}
	pipe := h.c.Pipeline()
	types := make([]*redis.StatusCmd, len(keys))
	ttls := make([]*redis.DurationCmd, len(keys))
	for i, k := range keys {
		types[i] = pipe.Type(ctx, k)
		ttls[i] = pipe.TTL(ctx, k)
	}
	if len(keys) > 0 {
		if _, err := pipe.Exec(ctx); err != nil && !errors.Is(err, redis.Nil) {
			return nil, err
		}
	}
	page := &KeyPage{Keys: make([]Key, len(keys)), Cursor: next}
	for i, k := range keys {
		// go-redis returns the -1/-2 sentinels as raw durations
		ttl := int64(ttls[i].Val())
		if ttl >= 0 {
			ttl = int64(ttls[i].Val() / time.Second)
		}
		page.Keys[i] = Key{Key: k, Type: types[i].Val(), TTL: ttl}
	}
	sort.Slice(page.Keys, func(i, j int) bool { return page.Keys[i].Key < page.Keys[j].Key })
	page.DBSize, _ = h.c.DBSize(ctx).Result()
	return page, nil
}

// SplitCommand splits a command line like a shell: spaces, "double" and 'single' quotes.
func SplitCommand(s string) ([]string, error) {
	var out []string
	var cur strings.Builder
	var quote rune
	has := false
	esc := false
	for _, r := range s {
		switch {
		case esc:
			switch r {
			case 'n':
				cur.WriteRune('\n')
			case 't':
				cur.WriteRune('\t')
			default:
				cur.WriteRune(r)
			}
			esc = false
		case r == '\\' && quote == '"':
			esc = true
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				cur.WriteRune(r)
			}
		case r == '"' || r == '\'':
			quote, has = r, true
		case r == ' ' || r == '\t' || r == '\n' || r == '\r':
			if cur.Len() > 0 || has {
				out = append(out, cur.String())
				cur.Reset()
				has = false
			}
		default:
			cur.WriteRune(r)
		}
	}
	if quote != 0 {
		return nil, errors.New("unterminated quote")
	}
	if cur.Len() > 0 || has {
		out = append(out, cur.String())
	}
	return out, nil
}

// Allowed reports whether a command may run on a read-only connection.
func (h *Handle) Allowed(args []string) error {
	if !h.readOnly {
		return nil
	}
	name := strings.ToLower(args[0])
	ro, known := h.readCmds[name]
	if !known {
		return fmt.Errorf("unknown command %q", args[0])
	}
	if !ro {
		return fmt.Errorf("%s is not a read-only command (this connection is read-only)", strings.ToUpper(name))
	}
	return nil
}

// Exec runs one command line and shapes the reply as a table.
func (h *Handle) Exec(ctx context.Context, line string, limit int) (*result.Result, error) {
	args, err := SplitCommand(line)
	if err != nil {
		return nil, err
	}
	if len(args) == 0 {
		return nil, errors.New("empty command")
	}
	if err := h.Allowed(args); err != nil {
		return nil, err
	}
	switch strings.ToLower(args[0]) {
	case "subscribe", "psubscribe", "ssubscribe", "monitor", "blpop", "brpop", "brpoplpush", "blmove", "bzpopmin", "bzpopmax", "wait", "waitaof":
		return nil, fmt.Errorf("%s blocks the only connection and is not supported", strings.ToUpper(args[0]))
	case "select":
		return nil, errors.New("SELECT would change the database of the only connection; set the DB in the connection settings")
	}
	start := time.Now()
	iargs := make([]any, len(args))
	for i, a := range args {
		iargs[i] = a
	}
	v, err := h.c.Do(ctx, iargs...).Result()
	if errors.Is(err, redis.Nil) {
		r := result.New("value")
		r.Rows = append(r.Rows, []any{nil})
		r.ElapsedMs = time.Since(start).Milliseconds()
		return r, nil
	}
	if err != nil {
		return nil, err
	}
	res := shape(strings.ToLower(args[0]), args, v, limit)
	res.ElapsedMs = time.Since(start).Milliseconds()
	return res, nil
}

func shape(cmd string, args []string, v any, limit int) *result.Result {
	if limit <= 0 {
		limit = 1000
	}
	upper := strings.ToUpper(strings.Join(args, " "))
	arr, isArr := v.([]any)
	var res *result.Result
	switch {
	case !isArr:
		s := scalar(v)
		if cmd == "info" || cmd == "memory" || cmd == "client" || cmd == "cluster" {
			if str, ok := v.(string); ok {
				res = result.New("line")
				for _, l := range strings.Split(strings.TrimSpace(str), "\n") {
					res.Rows = append(res.Rows, []any{strings.TrimRight(l, "\r")})
				}
				break
			}
		}
		res = result.New("value")
		res.Rows = append(res.Rows, []any{s})
	case cmd == "hgetall" || (cmd == "config" && len(args) > 1 && strings.EqualFold(args[1], "get")):
		res = pairs(arr, "field", "value")
	case strings.HasPrefix(cmd, "z") && strings.Contains(upper, "WITHSCORES"):
		res = pairs(arr, "member", "score")
	case cmd == "hscan" || cmd == "zscan" || cmd == "sscan" || cmd == "scan":
		if len(arr) == 2 {
			if items, ok := arr[1].([]any); ok {
				if cmd == "hscan" {
					res = pairs(items, "field", "value")
				} else if cmd == "zscan" {
					res = pairs(items, "member", "score")
				} else {
					res = list(items)
				}
				res.Message = fmt.Sprintf("next cursor: %v", scalar(arr[0]))
			}
		}
	case cmd == "xrange" || cmd == "xrevrange":
		res = result.New("id", "fields")
		for _, e := range arr {
			if p, ok := e.([]any); ok && len(p) == 2 {
				res.Rows = append(res.Rows, []any{scalar(p[0]), scalar(p[1])})
			}
		}
	}
	if res == nil {
		res = list(arr)
	}
	if len(res.Rows) > limit {
		res.Rows = res.Rows[:limit]
		res.Truncated = true
	}
	return res
}

func list(arr []any) *result.Result {
	res := result.New("index", "value")
	for i, x := range arr {
		res.Rows = append(res.Rows, []any{i, scalar(x)})
	}
	return res
}

func pairs(arr []any, a, b string) *result.Result {
	res := result.New(a, b)
	for i := 0; i+1 < len(arr); i += 2 {
		res.Rows = append(res.Rows, []any{scalar(arr[i]), scalar(arr[i+1])})
	}
	return res
}

// scalar makes a reply value displayable; nested arrays become compact JSON.
func scalar(v any) any {
	switch x := v.(type) {
	case nil:
		return nil
	case string, int64, bool, float64:
		return x
	case []any:
		out := make([]any, len(x))
		for i := range x {
			out[i] = scalar(x[i])
		}
		b, _ := json.Marshal(out)
		return string(b)
	default:
		return fmt.Sprint(x)
	}
}
