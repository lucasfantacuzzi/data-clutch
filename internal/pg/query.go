package pg

import (
	"context"
	"encoding/hex"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"data-clutch/internal/result"
)

// Stream runs one statement on the single connection and feeds rows to onRow.
// When readOnly, the statement runs inside a READ ONLY transaction that is
// always rolled back. onCols is called once before the first row. The returned
// string is the command tag for statements that return no columns.
func (h *Handle) Stream(ctx context.Context, sql string, readOnly bool, onCols func([]result.Col, []uint32) error, onRow func([]any) error) (string, error) {
	// pgx tears the connection down when a context is cancelled mid-query. This
	// server will not let us reconnect quickly, so the query runs on a context
	// that never cancels and a user cancel goes out as a protocol-level
	// CancelRequest, which leaves the session alive.
	userCtx := ctx
	ctx = context.WithoutCancel(userCtx)
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		select {
		case <-userCtx.Done():
			cctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = h.conn.PgConn().CancelRequest(cctx)
		case <-stop:
		}
	}()

	var q interface {
		Query(context.Context, string, ...any) (pgx.Rows, error)
	} = h.conn
	if readOnly {
		tx, err := h.conn.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
		if err != nil {
			return "", err
		}
		defer func() {
			rctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = tx.Rollback(rctx)
		}()
		q = tx
	}
	rows, err := q.Query(ctx, sql, pgx.QueryExecModeSimpleProtocol)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	fds := rows.FieldDescriptions()
	if len(fds) > 0 {
		cols := make([]result.Col, len(fds))
		oids := make([]uint32, len(fds))
		for i, fd := range fds {
			cols[i] = result.Col{Name: fd.Name, Type: h.typeName(fd.DataTypeOID)}
			oids[i] = fd.DataTypeOID
		}
		if err := onCols(cols, oids); err != nil {
			return "", err
		}
		for rows.Next() {
			vals, err := rows.Values()
			if err != nil {
				return "", err
			}
			for i := range vals {
				vals[i] = display(vals[i])
			}
			if err := onRow(vals); err != nil {
				return "", err
			}
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return "", err
	}
	return rows.CommandTag().String(), nil
}

func (h *Handle) typeName(oid uint32) string {
	if t, ok := h.conn.TypeMap().TypeForOID(oid); ok {
		return t.Name
	}
	return fmt.Sprintf("oid:%d", oid)
}

// Query collects up to limit rows (limit<=0 means 1000) into a Result.
func (h *Handle) Query(ctx context.Context, sql string, readOnly bool, limit int) (*result.Result, error) {
	if limit <= 0 {
		limit = 1000
	}
	start := time.Now()
	res := &result.Result{Columns: []result.Col{}, Rows: [][]any{}}
	errStop := fmt.Errorf("limit reached")
	tag, err := h.Stream(ctx, sql, readOnly,
		func(c []result.Col, _ []uint32) error { res.Columns = c; return nil },
		func(r []any) error {
			if len(res.Rows) >= limit {
				res.Truncated = true
				return errStop
			}
			res.Rows = append(res.Rows, r)
			return nil
		})
	if err != nil && !res.Truncated {
		return nil, err
	}
	if len(res.Columns) == 0 {
		res.Message = tag
	}
	res.ElapsedMs = time.Since(start).Milliseconds()
	return res, nil
}

// display turns driver values into JSON-friendly ones for the grid.
func display(v any) any {
	switch x := v.(type) {
	case nil, bool, string, float32, float64, int16, int32:
		return x
	case int64:
		if x > 1<<53 || x < -(1<<53) {
			return fmt.Sprint(x)
		}
		return x
	case time.Time:
		return x.Format(time.RFC3339Nano)
	case pgtype.Numeric:
		if !x.Valid {
			return nil
		}
		if x.NaN {
			return "NaN"
		}
		b, err := x.MarshalJSON()
		if err != nil {
			return fmt.Sprint(x)
		}
		return strings.Trim(string(b), `"`)
	case [16]byte:
		return fmt.Sprintf("%x-%x-%x-%x-%x", x[0:4], x[4:6], x[6:8], x[8:10], x[10:16])
	case []byte:
		return `\x` + hex.EncodeToString(x)
	case pgtype.Interval:
		return fmt.Sprintf("%dmo %dd %s", x.Months, x.Days, time.Duration(x.Microseconds)*time.Microsecond)
	case []any, map[string]any:
		return x
	default:
		if f, ok := v.(interface{ Float64Value() (pgtype.Float8, error) }); ok {
			if f8, err := f.Float64Value(); err == nil && f8.Valid && !math.IsNaN(f8.Float64) {
				return f8.Float64
			}
		}
		return fmt.Sprint(v)
	}
}
