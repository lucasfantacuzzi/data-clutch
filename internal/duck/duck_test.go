package duck

import (
	"context"
	"path/filepath"
	"testing"
)

func open(t *testing.T) *DB {
	d, err := Open(filepath.Join(t.TempDir(), "t.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

func save(t *testing.T, d *DB, name, mode string, rows [][]any) error {
	ctx := context.Background()
	w, err := d.Begin(ctx, name, mode, []string{"id", "label", "day", "n"}, []string{"INTEGER", "VARCHAR", "DATE", "DOUBLE"})
	if err != nil {
		return err
	}
	for _, r := range rows {
		types := []string{"INTEGER", "VARCHAR", "DATE", "DOUBLE"}
		for i := range r {
			r[i] = Coerce(r[i], types[i])
		}
		if err := w.Append(r); err != nil {
			w.Rollback()
			return err
		}
	}
	_, err = w.Commit("pg1", "postgres", "select 1")
	return err
}

func TestSaveModesAndDrop(t *testing.T) {
	d := open(t)
	ctx := context.Background()
	rows := func() [][]any {
		return [][]any{{int32(1), "a", "2024-05-06T00:00:00Z", "1.5"}, {int32(2), nil, nil, "NaN"}}
	}
	if err := save(t, d, "My Table!", ModeCreate, rows()); err != nil {
		t.Fatal(err)
	}
	if err := save(t, d, "my_table", ModeCreate, rows()); err == nil {
		t.Fatal("create over existing must fail")
	}
	if err := save(t, d, "my_table", ModeAppend, rows()); err != nil {
		t.Fatal(err)
	}
	if err := save(t, d, "my_table", ModeReplace, rows()[:1]); err != nil {
		t.Fatal(err)
	}
	ts, err := d.Tables(ctx)
	if err != nil || len(ts) != 1 {
		t.Fatalf("%v %+v", err, ts)
	}
	if ts[0].Name != "my_table" || ts[0].Rows != 1 || ts[0].SourceConn != "pg1" || len(ts[0].Columns) != 4 {
		t.Fatalf("%+v", ts[0])
	}
	if err := d.Drop(ctx, "my_table"); err != nil {
		t.Fatal(err)
	}
	if ts, _ := d.Tables(ctx); len(ts) != 0 {
		t.Fatal("not dropped")
	}
}

func TestReplaceFailureKeepsOldData(t *testing.T) {
	d := open(t)
	ctx := context.Background()
	save(t, d, "t", ModeCreate, [][]any{{int32(1), "a", nil, nil}})
	w, err := d.Begin(ctx, "t", ModeReplace, []string{"x"}, []string{"INTEGER"})
	if err != nil {
		t.Fatal(err)
	}
	w.Append([]any{int32(9)})
	w.Rollback()
	r, err := d.Query(ctx, "select count(*) from t", 10)
	if err != nil || r.Rows[0][0].(int64) != 1 {
		t.Fatalf("%v %+v", err, r)
	}
}

func TestReadOnlyQuery(t *testing.T) {
	d := open(t)
	ctx := context.Background()
	save(t, d, "t", ModeCreate, [][]any{{int32(1), "a", nil, nil}})
	if _, err := d.ReadOnlyQuery(ctx, "select * from t", 10); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		"drop table t", "insert into t values (1,'x',null,null)", "select 1; drop table t",
		"with x as (select 1) delete from t", "copy t to '/tmp/x.csv'", "select * from read_csv('/etc/passwd')",
		"attach '/tmp/other.db'", "pragma version",
	} {
		if _, err := d.ReadOnlyQuery(ctx, q, 10); err == nil {
			t.Errorf("must reject: %s", q)
		}
	}
	if ts, _ := d.Tables(ctx); len(ts) != 1 {
		t.Fatal("table was modified")
	}
}
