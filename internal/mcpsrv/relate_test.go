package mcpsrv

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"data-clutch/internal/duck"
	"data-clutch/internal/result"
)

func save(t *testing.T, db *duck.DB, name string, cols, types []string, rows [][]any) {
	t.Helper()
	w, err := db.Begin(context.Background(), name, duck.ModeCreate, cols, types)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if err := w.Append(r); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := w.Commit("pg", "postgres", "select 1"); err != nil {
		t.Fatal(err)
	}
}

func fixture(t *testing.T) *duck.DB {
	db, err := duck.Open(filepath.Join(t.TempDir(), "r.duckdb"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	var cust, ord, sessions, prods [][]any
	for i := 1; i <= 10; i++ {
		cust = append(cust, []any{int32(i), "c", []string{"BR", "US"}[i%2]})
		prods = append(prods, []any{int32(i), "p"})
	}
	for i := 1; i <= 40; i++ {
		cid := int32(1 + i%10)
		if i == 40 {
			cid = 99 // orphan order
		}
		ord = append(ord, []any{int32(i), cid, float64(i%30) + 0.5})
	}
	for i := 1; i <= 20; i++ {
		sessions = append(sessions, []any{"s", int32(1 + i%5)}) // redis-like: text-typed user ids
	}
	for i := range sessions {
		sessions[i][1] = []string{"1", "2", "3", "4", "5"}[i%5]
	}
	save(t, db, "customers", []string{"id", "name", "country"}, []string{"INTEGER", "VARCHAR", "VARCHAR"}, cust)
	save(t, db, "orders", []string{"id", "customer_id", "total"}, []string{"INTEGER", "INTEGER", "DOUBLE"}, ord)
	save(t, db, "products", []string{"id", "label"}, []string{"INTEGER", "VARCHAR"}, prods)
	save(t, db, "sessions", []string{"token", "user_id"}, []string{"VARCHAR", "VARCHAR"}, sessions)
	return db
}

func TestRelateTablesFindsForeignKey(t *testing.T) {
	db := fixture(t)
	out, err := RelateTables(context.Background(), db, "customers", "orders", 5)
	if err != nil {
		t.Fatal(err)
	}
	c := out["candidates"].([]*Candidate)
	if len(c) == 0 {
		t.Fatal("no candidates")
	}
	top := c[0]
	if top.AColumn != "id" || top.BColumn != "customer_id" {
		t.Fatalf("%+v", top)
	}
	if !top.AUnique || top.BUnique || top.Confidence < 0.7 {
		t.Fatalf("%+v", top)
	}
	if top.OrphanBRows != 1 || top.JoinRows != 39 {
		t.Fatalf("orphans=%d join=%d", top.OrphanBRows, top.JoinRows)
	}
	t.Logf("%s | conf=%v | %s", top.Relationship, top.Confidence, out["summary"])
}

func TestRelateTablesUnrelatedIdsAreNotConfident(t *testing.T) {
	db := fixture(t)
	out, err := RelateTables(context.Background(), db, "customers", "products", 5)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range out["candidates"].([]*Candidate) {
		if c.Confidence > 0.4 {
			t.Fatalf("coincidental ids rated %v: %+v", c.Confidence, c)
		}
	}
}

func TestRelateTextKeyToNumericKey(t *testing.T) {
	db := fixture(t)
	out, err := RelateTables(context.Background(), db, "customers", "sessions", 5)
	if err != nil {
		t.Fatal(err)
	}
	c := out["candidates"].([]*Candidate)
	if len(c) == 0 || c[0].BColumn != "user_id" || c[0].OrphanBRows != 0 || c[0].Confidence < 0.7 {
		t.Fatalf("%+v", c)
	}
}

func TestSuggestJoinsAndExplore(t *testing.T) {
	db := fixture(t)
	out, err := SuggestJoins(context.Background(), db)
	if err != nil {
		t.Fatal(err)
	}
	links := out["links"]
	if links == nil {
		t.Fatal("no links")
	}
	ex, err := ExploreTable(context.Background(), db, "orders")
	if err != nil {
		t.Fatal(err)
	}
	keys := ex["candidate_keys"].([]string)
	if len(keys) == 0 || keys[0] != "id" {
		t.Fatalf("%v", keys)
	}
	var roles = map[string]string{}
	for _, c := range ex["columns"].([]columnInsight) {
		roles[c.Name] = c.Role
	}
	if roles["customer_id"] != "foreign key candidate" || roles["total"] != "measure" {
		t.Fatalf("%v", roles)
	}
	if _, err := ExploreTable(context.Background(), db, `x"; drop table orders; --`); err == nil {
		t.Fatal("unknown table accepted")
	}
}

func TestExplainTableMasksAndReportsAnomalies(t *testing.T) {
	db := fixture(t)
	var rows [][]any
	for i := 1; i <= 300; i++ {
		amount := float64(i%40) + 1
		if i == 7 {
			amount = -50
		}
		if i == 8 {
			amount = 100000
		}
		rows = append(rows, []any{int32(i), int32(1 + i%10), "user" + string(rune('a'+i%20)) + "@example.com", amount, "const"})
	}
	save(t, db, "payments", []string{"id", "customer_id", "email", "amount", "channel"}, []string{"INTEGER", "INTEGER", "VARCHAR", "DOUBLE", "VARCHAR"}, rows)

	out, err := ExplainTable(context.Background(), db, "payments", 0, true)
	if err != nil {
		t.Fatal(err)
	}
	masked := out["masked_columns"].(map[string]string)
	if _, ok := masked["email"]; !ok {
		t.Fatalf("email not masked: %v", masked)
	}
	sample := out["sample"].(*result.Result)
	if len(sample.Rows) != 200 {
		t.Fatalf("sample rows = %d, want 200", len(sample.Rows))
	}
	for _, r := range sample.Rows {
		if r[2] != maskedValue {
			t.Fatalf("raw email leaked: %v", r[2])
		}
	}
	anoms := strings.Join(out["anomalies"].([]string), " | ")
	for _, want := range []string{`"channel" has a single value`, `"amount" looks like an amount or quantity but has 1 negative`, `outliers`} {
		if !strings.Contains(anoms, want) {
			t.Errorf("missing anomaly %q in: %s", want, anoms)
		}
	}
	links := out["links"].([]map[string]any)
	found := false
	for _, l := range links {
		if l["other_table"] == "customers" {
			found = true
		}
	}
	if !found {
		t.Fatalf("link to customers not found: %v", links)
	}

	raw, err := ExplainTable(context.Background(), db, "payments", 10, false)
	if err != nil {
		t.Fatal(err)
	}
	rs := raw["sample"].(*result.Result)
	if len(rs.Rows) != 10 || rs.Rows[0][2] == maskedValue {
		t.Fatalf("unmasked sample wrong: %d %v", len(rs.Rows), rs.Rows[0][2])
	}
	if !strings.Contains(ExplainPrompt("payments"), "explain_table") {
		t.Fatal("prompt must point at the tool")
	}
}
