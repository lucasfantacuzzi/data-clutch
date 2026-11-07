// Package mcpsrv exposes the saved DuckDB tables (and only those) over MCP.
package mcpsrv

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"data-clutch/internal/duck"
)

type Server struct {
	http *http.Server
	ln   net.Listener
}

func quote(id string) string { return `"` + strings.ReplaceAll(id, `"`, `""`) + `"` }

func NewMCP(db *duck.DB) *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{Name: "data-clutch", Version: "0.1.0"}, &mcp.ServerOptions{
		Instructions: "Query results saved from databases into a local DuckDB. Start with list_tables, then describe_table / summarize_table / column_profile, and use query for analysis. All access is read-only.",
	})

	text := func(v any) (*mcp.CallToolResult, any, error) {
		b, err := json.Marshal(v)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(b)}}}, nil, nil
	}

	// table must be a real saved table: never interpolate a name we did not see in the catalog.
	requireTable := func(ctx context.Context, name string) (*duck.TableInfo, error) {
		ts, err := db.Tables(ctx)
		if err != nil {
			return nil, err
		}
		for i := range ts {
			if ts[i].Name == name {
				return &ts[i], nil
			}
		}
		return nil, fmt.Errorf("unknown table %q (use list_tables)", name)
	}

	type none struct{}
	mcp.AddTool(s, &mcp.Tool{Name: "list_tables", Description: "List saved tables with row counts, columns and where each came from."},
		func(ctx context.Context, _ *mcp.CallToolRequest, _ none) (*mcp.CallToolResult, any, error) {
			ts, err := db.Tables(ctx)
			if err != nil {
				return nil, nil, err
			}
			return text(ts)
		})

	type tableArg struct {
		Table string `json:"table" jsonschema:"saved table name"`
	}
	mcp.AddTool(s, &mcp.Tool{Name: "describe_table", Description: "Columns, types, row count and origin (source connection and SQL) of a saved table."},
		func(ctx context.Context, _ *mcp.CallToolRequest, a tableArg) (*mcp.CallToolResult, any, error) {
			t, err := requireTable(ctx, a.Table)
			if err != nil {
				return nil, nil, err
			}
			return text(t)
		})
	mcp.AddTool(s, &mcp.Tool{Name: "table_origin", Description: "The source connection kind, SQL and time a table was saved from."},
		func(ctx context.Context, _ *mcp.CallToolRequest, a tableArg) (*mcp.CallToolResult, any, error) {
			t, err := requireTable(ctx, a.Table)
			if err != nil {
				return nil, nil, err
			}
			return text(map[string]any{"table": t.Name, "sourceConn": t.SourceConn, "sourceKind": t.SourceKind, "sourceSql": t.SourceSQL, "savedAt": t.CreatedAt, "rows": t.Rows})
		})

	type sampleArg struct {
		Table string `json:"table"`
		Limit int    `json:"limit,omitempty" jsonschema:"rows to return, default 20, max 100"`
	}
	mcp.AddTool(s, &mcp.Tool{Name: "sample_rows", Description: "A random sample of rows from a saved table."},
		func(ctx context.Context, _ *mcp.CallToolRequest, a sampleArg) (*mcp.CallToolResult, any, error) {
			if _, err := requireTable(ctx, a.Table); err != nil {
				return nil, nil, err
			}
			n := a.Limit
			if n <= 0 {
				n = 20
			}
			if n > 100 {
				n = 100
			}
			r, err := db.ReadOnlyQuery(ctx, fmt.Sprintf("select * from %s using sample %d rows", quote(a.Table), n), n)
			if err != nil {
				return nil, nil, err
			}
			return text(r)
		})
	mcp.AddTool(s, &mcp.Tool{Name: "summarize_table", Description: "DuckDB SUMMARIZE of a table: per-column min, max, approx distinct, mean, std, quartiles, null percentage."},
		func(ctx context.Context, _ *mcp.CallToolRequest, a tableArg) (*mcp.CallToolResult, any, error) {
			if _, err := requireTable(ctx, a.Table); err != nil {
				return nil, nil, err
			}
			r, err := db.ReadOnlyQuery(ctx, "summarize "+quote(a.Table), 500)
			if err != nil {
				return nil, nil, err
			}
			return text(r)
		})

	type colArg struct {
		Table  string `json:"table"`
		Column string `json:"column"`
	}
	mcp.AddTool(s, &mcp.Tool{Name: "column_profile", Description: "Counts, nulls, distinct values, min/max and the 10 most frequent values of one column."},
		func(ctx context.Context, _ *mcp.CallToolRequest, a colArg) (*mcp.CallToolResult, any, error) {
			t, err := requireTable(ctx, a.Table)
			if err != nil {
				return nil, nil, err
			}
			found := false
			for _, c := range t.Columns {
				if c.Name == a.Column {
					found = true
				}
			}
			if !found {
				return nil, nil, fmt.Errorf("unknown column %q in %q", a.Column, a.Table)
			}
			tb, col := quote(a.Table), quote(a.Column)
			stats, err := db.ReadOnlyQuery(ctx, fmt.Sprintf(
				"select count(*) as total, count(%[2]s) as non_null, count(*)-count(%[2]s) as nulls, count(distinct %[2]s) as distinct_values, min(%[2]s)::varchar as min, max(%[2]s)::varchar as max from %[1]s", tb, col), 1)
			if err != nil {
				return nil, nil, err
			}
			top, err := db.ReadOnlyQuery(ctx, fmt.Sprintf(
				"select %[2]s::varchar as value, count(*) as n from %[1]s group by 1 order by n desc, 1 limit 10", tb, col), 10)
			if err != nil {
				return nil, nil, err
			}
			return text(map[string]any{"stats": stats, "topValues": top})
		})

	type queryArg struct {
		SQL   string `json:"sql" jsonschema:"one read-only DuckDB statement (SELECT/WITH/FROM/DESCRIBE/SUMMARIZE/SHOW/EXPLAIN)"`
		Limit int    `json:"limit,omitempty" jsonschema:"max rows, default 200, max 5000"`
	}
	mcp.AddTool(s, &mcp.Tool{Name: "query", Description: "Run a read-only DuckDB SQL query over the saved tables. Writes, file access and multiple statements are rejected."},
		func(ctx context.Context, _ *mcp.CallToolRequest, a queryArg) (*mcp.CallToolResult, any, error) {
			n := a.Limit
			if n <= 0 {
				n = 200
			}
			if n > 5000 {
				n = 5000
			}
			qctx, cancel := context.WithTimeout(ctx, 30*time.Second)
			defer cancel()
			r, err := db.ReadOnlyQuery(qctx, a.SQL, n)
			if err != nil {
				return nil, nil, err
			}
			return text(r)
		})
	return s
}

// Start listens on addr (host:port) and serves MCP at /mcp, requiring the bearer token.
func Start(addr, token string, db *duck.DB) (*Server, error) {
	if token == "" {
		return nil, errors.New("empty token")
	}
	srv := NewMCP(db)
	h := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return srv }, nil)
	mux := http.NewServeMux()
	mux.Handle("/mcp", authed(token, h))
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, err
	}
	s := &Server{ln: ln, http: &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}}
	go s.http.Serve(ln)
	return s, nil
}

func (s *Server) Addr() string { return s.ln.Addr().String() }

func (s *Server) Stop() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := s.http.Shutdown(ctx); err != nil {
		s.http.Close()
	}
}

func authed(token string, next http.Handler) http.Handler {
	want := []byte("Bearer " + token)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), want) != 1 {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}
