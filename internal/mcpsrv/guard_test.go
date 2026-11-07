package mcpsrv

import (
	"net/http"
	"net/http/httptest"
	"testing"
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
