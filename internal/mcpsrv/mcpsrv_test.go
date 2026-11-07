package mcpsrv

import (
	"context"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"data-clutch/internal/duck"
)

type bearer struct{ tok string }

func (b bearer) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.tok)
	return http.DefaultTransport.RoundTrip(r)
}

func TestMCPEndToEnd(t *testing.T) {
	ctx := context.Background()
	db, err := duck.Open(filepath.Join(t.TempDir(), "m.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	w, _ := db.Begin(ctx, "orders", duck.ModeCreate, []string{"id", "status"}, []string{"INTEGER", "VARCHAR"})
	for i := 0; i < 5; i++ {
		w.Append([]any{int32(i), []string{"paid", "open"}[i%2]})
	}
	if _, err := w.Commit("pg", "postgres", "select * from orders"); err != nil {
		t.Fatal(err)
	}

	s, err := Start("127.0.0.1:0", "secret", db)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Stop()
	url := "http://" + s.Addr() + "/mcp"

	if resp, _ := http.Post(url, "application/json", strings.NewReader("{}")); resp == nil || resp.StatusCode != 401 {
		t.Fatalf("unauthenticated request must get 401, got %v", resp)
	}

	client := mcp.NewClient(&mcp.Implementation{Name: "t", Version: "1"}, nil)
	sess, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: url, HTTPClient: &http.Client{Transport: bearer{"secret"}}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()

	call := func(name string, args map[string]any) (string, bool) {
		r, err := sess.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
		if err != nil {
			t.Fatal(name, err)
		}
		var sb strings.Builder
		for _, c := range r.Content {
			if tc, ok := c.(*mcp.TextContent); ok {
				sb.WriteString(tc.Text)
			}
		}
		return sb.String(), r.IsError
	}

	if out, isErr := call("list_tables", nil); isErr || !strings.Contains(out, `"orders"`) {
		t.Fatalf("%v %s", isErr, out)
	}
	if out, isErr := call("query", map[string]any{"sql": "select status, count(*) n from orders group by 1 order by 1"}); isErr || !strings.Contains(out, "paid") {
		t.Fatalf("%v %s", isErr, out)
	}
	if out, isErr := call("column_profile", map[string]any{"table": "orders", "column": "status"}); isErr || !strings.Contains(out, "topValues") {
		t.Fatalf("%v %s", isErr, out)
	}
	if _, isErr := call("summarize_table", map[string]any{"table": "orders"}); isErr {
		t.Fatal("summarize failed")
	}
	if _, isErr := call("sample_rows", map[string]any{"table": "orders", "limit": 2}); isErr {
		t.Fatal("sample failed")
	}
	for _, q := range []string{"drop table orders", "delete from orders", "select 1; drop table orders"} {
		if _, isErr := call("query", map[string]any{"sql": q}); !isErr {
			t.Errorf("must reject %q", q)
		}
	}
	if _, isErr := call("describe_table", map[string]any{"table": `orders"; drop table orders; --`}); !isErr {
		t.Error("unknown table name must be rejected")
	}
	if out, _ := call("list_tables", nil); !strings.Contains(out, `"orders"`) {
		t.Fatal("table vanished")
	}
}
