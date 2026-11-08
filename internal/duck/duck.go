// Package duck owns the local DuckDB file where query results are saved.
package duck

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	_ "github.com/marcboeker/go-duckdb/v2"

	"data-clutch/internal/result"
)

const MetaTable = "_clutch_meta"

type DB struct {
	db *sql.DB
}

func Open(path string) (*DB, error) {
	db, err := sql.Open("duckdb", path)
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		return nil, err
	}
	d := &DB{db: db}
	if _, err := db.Exec(`create table if not exists ` + MetaTable + `(
		table_name varchar primary key, source_conn varchar, source_kind varchar,
		source_sql varchar, created_at timestamp, row_count bigint, mode varchar)`); err != nil {
		return nil, err
	}
	// Nothing in this app reads or writes outside the database file. Turning
	// external access off makes read_csv()/COPY/ATTACH unavailable to the SQL
	// console and the MCP server.
	if _, err := db.Exec(`set enable_external_access=false`); err != nil {
		return nil, err
	}
	return d, nil
}

func (d *DB) Close() error { return d.db.Close() }

var identRe = regexp.MustCompile(`[^a-zA-Z0-9_]+`)

// SanitizeName makes a safe table identifier.
func SanitizeName(n string) string {
	n = strings.Trim(identRe.ReplaceAllString(strings.TrimSpace(n), "_"), "_")
	if n == "" {
		n = "result"
	}
	if n[0] >= '0' && n[0] <= '9' {
		n = "t_" + n
	}
	return strings.ToLower(n)
}

func quote(id string) string { return `"` + strings.ReplaceAll(id, `"`, `""`) + `"` }

type TableInfo struct {
	Name       string `json:"name"`
	Rows       int64  `json:"rows"`
	Columns    []Col  `json:"columns"`
	SourceConn string `json:"sourceConn,omitempty"`
	SourceKind string `json:"sourceKind,omitempty"`
	SourceSQL  string `json:"sourceSql,omitempty"`
	CreatedAt  string `json:"createdAt,omitempty"`
}

type Col struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

func (d *DB) Tables(ctx context.Context) ([]TableInfo, error) {
	rows, err := d.db.QueryContext(ctx, `select table_name from information_schema.tables
		where table_schema='main' and table_type='BASE TABLE' and table_name <> ? order by 1`, MetaTable)
	if err != nil {
		return nil, err
	}
	var names []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			rows.Close()
			return nil, err
		}
		names = append(names, n)
	}
	rows.Close()

	out := make([]TableInfo, 0, len(names))
	for _, n := range names {
		ti := TableInfo{Name: n, Columns: []Col{}}
		crows, err := d.db.QueryContext(ctx, `select column_name, data_type from information_schema.columns
			where table_schema='main' and table_name=? order by ordinal_position`, n)
		if err != nil {
			return nil, err
		}
		for crows.Next() {
			var c Col
			if err := crows.Scan(&c.Name, &c.Type); err != nil {
				crows.Close()
				return nil, err
			}
			ti.Columns = append(ti.Columns, c)
		}
		crows.Close()
		_ = d.db.QueryRowContext(ctx, `select count(*) from `+quote(n)).Scan(&ti.Rows)
		var created sql.NullTime
		var src, kind, conn sql.NullString
		err = d.db.QueryRowContext(ctx, `select source_conn, source_kind, source_sql, created_at from `+MetaTable+` where table_name=?`, n).Scan(&conn, &kind, &src, &created)
		if err == nil {
			ti.SourceConn, ti.SourceKind, ti.SourceSQL = conn.String, kind.String, src.String
			if created.Valid {
				ti.CreatedAt = created.Time.Format(time.RFC3339)
			}
		}
		out = append(out, ti)
	}
	return out, nil
}

func (d *DB) Exists(ctx context.Context, name string) (bool, error) {
	var n int
	err := d.db.QueryRowContext(ctx, `select count(*) from information_schema.tables where table_schema='main' and table_name=?`, name).Scan(&n)
	return n > 0, err
}

func (d *DB) Drop(ctx context.Context, name string) error {
	if name == MetaTable {
		return errors.New("cannot drop the metadata table")
	}
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `drop table if exists `+quote(name)); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `delete from `+MetaTable+` where table_name=?`, name); err != nil {
		return err
	}
	return tx.Commit()
}

// Query runs arbitrary SQL for the local console (full access to saved tables).
func (d *DB) Query(ctx context.Context, q string, limit int) (*result.Result, error) {
	start := time.Now()
	rows, err := d.db.QueryContext(ctx, q)
	if err != nil {
		return nil, err
	}
	return collect(rows, limit, start)
}

var (
	firstWord = regexp.MustCompile(`(?i)^\s*(select|with|from|describe|summarize|show|explain|values|table)\b`)
)

// ReadOnlyQuery is for the MCP server: one statement, read keywords only,
// executed inside a READ ONLY transaction that is always rolled back.
func (d *DB) ReadOnlyQuery(ctx context.Context, q string, limit int) (*result.Result, error) {
	q = strings.TrimSpace(strings.TrimRight(strings.TrimSpace(q), ";"))
	if !firstWord.MatchString(q) {
		return nil, errors.New("only SELECT/WITH/FROM/DESCRIBE/SUMMARIZE/SHOW/EXPLAIN statements are allowed")
	}
	if hasSemicolonOutsideQuotes(q) {
		return nil, errors.New("only one statement is allowed")
	}
	conn, err := d.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `begin transaction read only`); err != nil {
		return nil, err
	}
	defer conn.ExecContext(context.Background(), `rollback`)
	start := time.Now()
	rows, err := conn.QueryContext(ctx, q)
	if err != nil {
		return nil, err
	}
	return collect(rows, limit, start)
}

// hasSemicolonOutsideQuotes reports whether s could contain more than one
// statement. It understands '...' and "..." (doubled quotes escape), -- and
// nested /* */ comments, and $tag$...$tag$ strings. Anything left unterminated
// counts as unsafe, so a quote hidden in a comment can't mask a later ';'.
func hasSemicolonOutsideQuotes(s string) bool {
	for i := 0; i < len(s); {
		c := s[i]
		switch {
		case c == ';':
			return true
		case c == '\'' || c == '"':
			j := i + 1
			for ; j < len(s); j++ {
				if s[j] == c {
					if j+1 < len(s) && s[j+1] == c { // doubled quote
						j++
						continue
					}
					break
				}
			}
			if j >= len(s) {
				return true
			}
			i = j + 1
		case c == '-' && i+1 < len(s) && s[i+1] == '-':
			j := strings.IndexByte(s[i:], '\n')
			if j < 0 {
				return false
			}
			i += j + 1
		case c == '/' && i+1 < len(s) && s[i+1] == '*':
			depth := 1
			j := i + 2
			for ; j+1 < len(s) && depth > 0; j++ {
				switch {
				case s[j] == '/' && s[j+1] == '*':
					depth++
					j++
				case s[j] == '*' && s[j+1] == '/':
					depth--
					j++
				}
			}
			if depth > 0 {
				return true
			}
			i = j
		case c == '$':
			if m := dollarTag.FindString(s[i:]); m != "" {
				end := strings.Index(s[i+len(m):], m)
				if end < 0 {
					return true
				}
				i += len(m) + end + len(m)
			} else {
				i++
			}
		default:
			i++
		}
	}
	return false
}

var dollarTag = regexp.MustCompile(`^\$([A-Za-z_][A-Za-z0-9_]*)?\$`)

func collect(rows *sql.Rows, limit int, start time.Time) (*result.Result, error) {
	defer rows.Close()
	if limit <= 0 {
		limit = 1000
	}
	names, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	types, _ := rows.ColumnTypes()
	res := &result.Result{Columns: make([]result.Col, len(names)), Rows: [][]any{}}
	for i, n := range names {
		res.Columns[i] = result.Col{Name: n}
		if i < len(types) {
			res.Columns[i].Type = strings.ToLower(types[i].DatabaseTypeName())
		}
	}
	for rows.Next() {
		if len(res.Rows) >= limit {
			res.Truncated = true
			break
		}
		vals := make([]any, len(names))
		ptrs := make([]any, len(names))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		for i := range vals {
			vals[i] = jsonSafe(vals[i])
		}
		res.Rows = append(res.Rows, vals)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	res.ElapsedMs = time.Since(start).Milliseconds()
	return res, nil
}

func jsonSafe(v any) any {
	switch x := v.(type) {
	case nil, bool, string, float32, float64, int8, int16, int32, uint8, uint16, uint32:
		return x
	case int64:
		if x > 1<<53 || x < -(1<<53) {
			return fmt.Sprint(x)
		}
		return x
	case time.Time:
		return x.Format(time.RFC3339Nano)
	case []byte:
		return fmt.Sprintf("\\x%x", x)
	case []any, map[string]any:
		return x
	default:
		return fmt.Sprint(v)
	}
}

// Mode of a save.
const (
	ModeCreate  = "create"
	ModeReplace = "replace"
	ModeAppend  = "append"
)

// Writer loads rows into a table in batches. Nothing is visible until Commit,
// so a failed or cancelled save leaves existing data untouched.
type Writer struct {
	d      *DB
	tx     *sql.Tx
	name   string // final name
	stage  string // table being filled
	mode   string
	ncols  int
	batch  [][]any
	rows   int64
	ctx    context.Context
	insert string
}

const batchRows = 500

// Begin prepares a save. kinds[i] is a DuckDB type for column i.
func (d *DB) Begin(ctx context.Context, name, mode string, colNames, colTypes []string) (*Writer, error) {
	name = SanitizeName(name)
	if name == MetaTable {
		return nil, errors.New("reserved table name")
	}
	exists, err := d.Exists(ctx, name)
	if err != nil {
		return nil, err
	}
	if exists && mode == ModeCreate {
		return nil, fmt.Errorf("table %q already exists (choose replace or append)", name)
	}
	if !exists && mode == ModeAppend {
		mode = ModeCreate
	}
	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	w := &Writer{d: d, tx: tx, name: name, mode: mode, ncols: len(colNames), ctx: ctx}
	target := name
	if mode == ModeReplace && exists {
		target = name + "__new"
		w.stage = target
		_, _ = tx.ExecContext(ctx, `drop table if exists `+quote(target))
	} else {
		w.stage = name
	}
	if mode != ModeAppend {
		defs := make([]string, len(colNames))
		for i := range colNames {
			defs[i] = quote(dedupe(colNames, i)) + " " + colTypes[i]
		}
		if _, err := tx.ExecContext(ctx, `create table `+quote(w.stage)+`(`+strings.Join(defs, ",")+`)`); err != nil {
			tx.Rollback()
			return nil, err
		}
	} else {
		var n int
		if err := tx.QueryRowContext(ctx, `select count(*) from information_schema.columns where table_schema='main' and table_name=?`, name).Scan(&n); err != nil {
			tx.Rollback()
			return nil, err
		}
		if n != len(colNames) {
			tx.Rollback()
			return nil, fmt.Errorf("table %q has %d columns, result has %d", name, n, len(colNames))
		}
	}
	return w, nil
}

// dedupe makes duplicate column names unique ("id", "id_2").
func dedupe(names []string, i int) string {
	n := names[i]
	if n == "" {
		n = fmt.Sprintf("column_%d", i+1)
	}
	c := 0
	for j := 0; j < i; j++ {
		if names[j] == names[i] {
			c++
		}
	}
	if c > 0 {
		return fmt.Sprintf("%s_%d", n, c+1)
	}
	return n
}

func (w *Writer) Append(row []any) error {
	w.batch = append(w.batch, row)
	w.rows++
	if len(w.batch) >= batchRows {
		return w.flush()
	}
	return nil
}

func (w *Writer) flush() error {
	if len(w.batch) == 0 {
		return nil
	}
	ph := "(" + strings.TrimSuffix(strings.Repeat("?,", w.ncols), ",") + ")"
	var sb strings.Builder
	sb.WriteString("insert into " + quote(w.stage) + " values ")
	args := make([]any, 0, len(w.batch)*w.ncols)
	for i, r := range w.batch {
		if i > 0 {
			sb.WriteByte(',')
		}
		sb.WriteString(ph)
		args = append(args, r...)
	}
	_, err := w.tx.ExecContext(w.ctx, sb.String(), args...)
	w.batch = w.batch[:0]
	return err
}

func (w *Writer) Rollback() { w.tx.Rollback() }

// Commit finishes the save and records its origin in the metadata table.
func (w *Writer) Commit(sourceConn, sourceKind, sourceSQL string) (int64, error) {
	if err := w.flush(); err != nil {
		w.tx.Rollback()
		return 0, err
	}
	ctx := w.ctx
	if w.stage != w.name {
		if _, err := w.tx.ExecContext(ctx, `drop table `+quote(w.name)); err != nil {
			w.tx.Rollback()
			return 0, err
		}
		if _, err := w.tx.ExecContext(ctx, `alter table `+quote(w.stage)+` rename to `+quote(w.name)); err != nil {
			w.tx.Rollback()
			return 0, err
		}
	}
	var total int64
	if err := w.tx.QueryRowContext(ctx, `select count(*) from `+quote(w.name)).Scan(&total); err != nil {
		w.tx.Rollback()
		return 0, err
	}
	// DuckDB can't update a row in a table with a primary key inside the same
	// transaction it was just changed in reliably, so delete + insert.
	if _, err := w.tx.ExecContext(ctx, `delete from `+MetaTable+` where table_name=?`, w.name); err != nil {
		w.tx.Rollback()
		return 0, err
	}
	if _, err := w.tx.ExecContext(ctx, `insert into `+MetaTable+` values (?,?,?,?,?,?,?)`,
		w.name, sourceConn, sourceKind, sourceSQL, time.Now().UTC(), total, w.mode); err != nil {
		w.tx.Rollback()
		return 0, err
	}
	return total, w.tx.Commit()
}

// PGType maps a PostgreSQL type name to the DuckDB column type used when saving.
func PGType(pg string) string {
	switch pg {
	case "bool":
		return "BOOLEAN"
	case "int2":
		return "SMALLINT"
	case "int4":
		return "INTEGER"
	case "int8":
		return "BIGINT"
	case "float4", "float8", "numeric", "money":
		return "DOUBLE"
	case "date":
		return "DATE"
	case "timestamp", "timestamptz":
		return "TIMESTAMP"
	default:
		return "VARCHAR"
	}
}

// Coerce converts a display value from a driver into something the DuckDB
// column type accepts.
func Coerce(v any, typ string) any {
	if v == nil {
		return nil
	}
	switch typ {
	case "DATE":
		if s, ok := v.(string); ok {
			if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
				return t.Format("2006-01-02")
			}
		}
	case "TIMESTAMP":
		if s, ok := v.(string); ok {
			if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
				return t.UTC()
			}
		}
	case "VARCHAR":
		switch x := v.(type) {
		case string:
			return x
		case []any, map[string]any:
			b, err := json.Marshal(x)
			if err == nil {
				return string(b)
			}
		}
		return fmt.Sprint(v)
	case "DOUBLE":
		if s, ok := v.(string); ok {
			if f, err := strconv.ParseFloat(s, 64); err == nil {
				return f
			}
			return nil
		}
	}
	return v
}
