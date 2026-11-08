package mcpsrv

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"data-clutch/internal/duck"
)

func TestLocalOnly(t *testing.T) {
	h := localOnly(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }))
	cases := []struct {
		host, origin string
		want         int
	}{
		{"127.0.0.1:7733", "", 200},
		{"localhost:7733", "", 200},
		{"localhost:7733", "http://localhost:3000", 200},
		{"evil.example.com:7733", "", 403},
		{"127.0.0.1:7733", "https://evil.example.com", 403},
	}
	for _, c := range cases {
		r := httptest.NewRequest("POST", "/mcp", nil)
		r.Host = c.host
		if c.origin != "" {
			r.Header.Set("Origin", c.origin)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != c.want {
			t.Errorf("host=%q origin=%q: got %d want %d", c.host, c.origin, w.Code, c.want)
		}
	}
}

func TestAuthed(t *testing.T) {
	h := authed("s3cret", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }))
	cases := []struct {
		name, header string
		want         int
	}{
		{"missing", "", 401},
		{"wrong token", "Bearer nope", 401},
		{"prefix of token", "Bearer s3cre", 401},
		{"token with suffix", "Bearer s3cret!", 401},
		{"wrong scheme", "Basic s3cret", 401},
		{"no scheme", "s3cret", 401},
		{"lowercase scheme", "bearer s3cret", 401},
		{"correct", "Bearer s3cret", 200},
	}
	for _, c := range cases {
		r := httptest.NewRequest("POST", "/mcp", nil)
		if c.header != "" {
			r.Header.Set("Authorization", c.header)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != c.want {
			t.Errorf("%s: got %d want %d", c.name, w.Code, c.want)
		}
		if c.want == 401 && w.Header().Get("WWW-Authenticate") == "" {
			t.Errorf("%s: missing WWW-Authenticate header", c.name)
		}
	}
}

func TestStartRefusesEmptyToken(t *testing.T) {
	if _, err := Start("127.0.0.1:0", "", nil); err == nil {
		t.Fatal("expected an error for an empty token")
	}
}

// The real listener: auth and the loopback check must both apply to /mcp, and
// nothing else may be served.
func TestServerEnforcesAuthAndHost(t *testing.T) {
	db, err := duck.Open(filepath.Join(t.TempDir(), "g.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	s, err := Start("127.0.0.1:0", "secret", db)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Stop()

	do := func(path, token, host, origin string) int {
		req, _ := http.NewRequest("POST", "http://"+s.Addr()+path, strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if host != "" {
			req.Host = host
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if got := do("/mcp", "", "", ""); got != 401 {
		t.Errorf("no token: got %d want 401", got)
	}
	if got := do("/mcp", "wrong", "", ""); got != 401 {
		t.Errorf("wrong token: got %d want 401", got)
	}
	// DNS rebinding: valid token, attacker-controlled Host or Origin
	if got := do("/mcp", "secret", "evil.example.com", ""); got != 403 {
		t.Errorf("rebinding host: got %d want 403", got)
	}
	if got := do("/mcp", "secret", "", "https://evil.example.com"); got != 403 {
		t.Errorf("foreign origin: got %d want 403", got)
	}
	// the host check runs before auth, so a foreign host never learns whether a token is valid
	if got := do("/mcp", "", "evil.example.com", ""); got != 403 {
		t.Errorf("rebinding host without token: got %d want 403", got)
	}
	if got := do("/other", "secret", "", ""); got != 404 {
		t.Errorf("unknown path: got %d want 404", got)
	}
	if got := do("/mcp", "secret", "", ""); got == 401 || got == 403 || got == 404 {
		t.Errorf("valid request was rejected: %d", got)
	}
}
