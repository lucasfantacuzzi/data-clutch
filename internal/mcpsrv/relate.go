package mcpsrv

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"data-clutch/internal/duck"
)

type family string

const (
	famNum   family = "numeric"
	famText  family = "text"
	famTime  family = "temporal"
	famBool  family = "boolean"
	famOther family = "other"
)

func familyOf(t string) family {
	u := strings.ToUpper(t)
	switch {
	case strings.HasPrefix(u, "DECIMAL"), strings.HasPrefix(u, "NUMERIC"):
		return famNum
	}
	switch u {
	case "TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "UTINYINT", "USMALLINT", "UINTEGER", "UBIGINT", "UHUGEINT", "FLOAT", "DOUBLE", "REAL":
		return famNum
	case "VARCHAR", "TEXT", "STRING", "UUID":
		return famText
	case "DATE", "TIMESTAMP", "TIMESTAMP WITH TIME ZONE", "TIMESTAMPTZ", "TIMESTAMP_S", "TIMESTAMP_MS", "TIMESTAMP_NS":
		return famTime
	case "BOOLEAN", "BOOL":
		return famBool
	}
	return famOther
}

var generic = map[string]bool{"id": true, "name": true, "created_at": true, "updated_at": true, "status": true, "type": true,
	"description": true, "title": true, "date": true, "value": true, "label": true, "country": true, "email": true}

func singular(s string) string {
	switch {
	case strings.HasSuffix(s, "ies"):
		return s[:len(s)-3] + "y"
	case strings.HasSuffix(s, "ses"), strings.HasSuffix(s, "xes"):
		return s[:len(s)-2]
	case strings.HasSuffix(s, "s") && !strings.HasSuffix(s, "ss"):
		return s[:len(s)-1]
	}
	return s
}

// nameScore rates how much two column names look like a key/foreign key pair (0..1).
func nameScore(tA, cA, tB, cB string) float64 {
	tA, cA, tB, cB = strings.ToLower(tA), strings.ToLower(cA), strings.ToLower(tB), strings.ToLower(cB)
	fk := func(ref, refCol, other, otherCol string) bool {
		if refCol != "id" && refCol != otherCol {
			return false
		}
		return otherCol == singular(ref)+"_id" || otherCol == ref+"_id" || otherCol == singular(ref)+"id" || otherCol == singular(ref)+"_key" || otherCol == singular(ref)+"_code"
	}
	if fk(tA, cA, tB, cB) || fk(tB, cB, tA, cA) {
		return 1
	}
	if cA == cB {
		if generic[cA] {
			return 0.2
		}
		return 0.7
	}
	if strings.TrimSuffix(cA, "_id") == strings.TrimSuffix(cB, "_id") && (strings.HasSuffix(cA, "_id") || strings.HasSuffix(cB, "_id")) {
		return 0.6
	}
	return 0
}

// expr builds the comparison expression for a column; numeric vs text compares as numbers.
func expr(alias, col string, f, other family) string {
	c := alias + "." + quote(col)
	switch {
	case f == famNum || other == famNum && f == famText:
		if f == famNum {
			return "cast(" + c + " as double)"
		}
		return "try_cast(" + c + " as double)"
	case f == famTime:
		return "cast(" + c + " as timestamp)"
	}
	return "cast(" + c + " as varchar)"
}

func num(v any) int64 {
	switch x := v.(type) {
	case int64:
		return x
	case int32:
		return int64(x)
	case float64:
		return int64(x)
	}
	return 0
}

func pct(a, b int64) float64 {
	if b == 0 {
		return 0
	}
	return float64(int(float64(a)/float64(b)*1000+0.5)) / 10
}

type Candidate struct {
	AColumn      string   `json:"a_column"`
	BColumn      string   `json:"b_column"`
	NameScore    float64  `json:"name_score"`
	ADistinct    int64    `json:"a_distinct"`
	BDistinct    int64    `json:"b_distinct"`
	Overlap      int64    `json:"overlapping_distinct_values"`
	AInBPct      float64  `json:"pct_of_a_values_found_in_b"`
	BInAPct      float64  `json:"pct_of_b_values_found_in_a"`
	AUnique      bool     `json:"a_unique"`
	BUnique      bool     `json:"b_unique"`
	OrphanARows  int64    `json:"a_rows_without_match"`
	OrphanBRows  int64    `json:"b_rows_without_match"`
	JoinRows     int64    `json:"rows_after_inner_join"`
	Relationship string   `json:"relationship"`
	Confidence   float64  `json:"confidence"`
	Notes        []string `json:"notes,omitempty"`
	JoinSQL      string   `json:"join_sql"`
}

type pair struct {
	a, b   duck.Col
	fa, fb family
	score  float64
}

func candidatePairs(ta, tb *duck.TableInfo, max int) []pair {
	var named, rest []pair
	for _, ca := range ta.Columns {
		for _, cb := range tb.Columns {
			fa, fb := familyOf(ca.Type), familyOf(cb.Type)
			ok := fa == fb && fa != famOther || (fa == famNum && fb == famText) || (fa == famText && fb == famNum)
			if !ok || fa == famBool && fb == famBool {
				continue
			}
			p := pair{ca, cb, fa, fb, nameScore(ta.Name, ca.Name, tb.Name, cb.Name)}
			if p.score > 0 {
				named = append(named, p)
			} else if fa != famTime && (strings.HasSuffix(strings.ToLower(ca.Name), "id") || strings.HasSuffix(strings.ToLower(cb.Name), "id") ||
				strings.HasSuffix(strings.ToLower(ca.Name), "key") || strings.HasSuffix(strings.ToLower(cb.Name), "key") || strings.HasSuffix(strings.ToLower(ca.Name), "code")) {
				rest = append(rest, p)
			}
		}
	}
	sort.SliceStable(named, func(i, j int) bool { return named[i].score > named[j].score })
	out := named
	if len(out) < 3 {
		out = append(out, rest...)
	}
	if len(out) > max {
		out = out[:max]
	}
	return out
}

func evaluate(ctx context.Context, db *duck.DB, ta, tb *duck.TableInfo, p pair) (*Candidate, error) {
	ea, eb := expr("a", p.a.Name, p.fa, p.fb), expr("b", p.b.Name, p.fb, p.fa)
	A, B := quote(ta.Name), quote(tb.Name)
	q := fmt.Sprintf(`with x as (select distinct %[1]s v from %[3]s a where %[1]s is not null),
	y as (select distinct %[2]s v from %[4]s b where %[2]s is not null)
	select
	 (select count(%[1]s) from %[3]s a), (select count(%[2]s) from %[4]s b),
	 (select count(*) from x), (select count(*) from y),
	 (select count(*) from x join y using (v)),
	 (select count(*) from %[3]s a where %[1]s is not null and %[1]s not in (select v from y)),
	 (select count(*) from %[4]s b where %[2]s is not null and %[2]s not in (select v from x)),
	 (select count(*) from %[3]s a join %[4]s b on %[1]s = %[2]s)`, ea, eb, A, B)
	r, err := db.ReadOnlyQuery(ctx, q, 1)
	if err != nil {
		return nil, err
	}
	v := r.Rows[0]
	nnA, nnB, dA, dB, ov, orA, orB, jr := num(v[0]), num(v[1]), num(v[2]), num(v[3]), num(v[4]), num(v[5]), num(v[6]), num(v[7])

	c := &Candidate{AColumn: p.a.Name, BColumn: p.b.Name, NameScore: p.score, ADistinct: dA, BDistinct: dB, Overlap: ov,
		AInBPct: pct(ov, dA), BInAPct: pct(ov, dB), AUnique: nnA > 0 && dA == nnA, BUnique: nnB > 0 && dB == nnB,
		OrphanARows: orA, OrphanBRows: orB, JoinRows: jr}
	c.JoinSQL = fmt.Sprintf("select * from %s a join %s b on %s = %s", A, B, ea, eb)
	if p.fa == famText && p.fb == famNum || p.fa == famNum && p.fb == famText {
		c.Notes = append(c.Notes, "one column is text and the other numeric: compared as numbers (text values that are not numbers are ignored)")
	}

	contain := c.AInBPct
	if c.BInAPct > contain {
		contain = c.BInAPct
	}
	switch {
	case c.AUnique && c.BUnique:
		c.Relationship = fmt.Sprintf("one-to-one (%s.%s <-> %s.%s)", ta.Name, p.a.Name, tb.Name, p.b.Name)
	case c.AUnique:
		c.Relationship = fmt.Sprintf("many-to-one: each row of %s points to one row of %s (%s.%s -> %s.%s)", tb.Name, ta.Name, tb.Name, p.b.Name, ta.Name, p.a.Name)
	case c.BUnique:
		c.Relationship = fmt.Sprintf("many-to-one: each row of %s points to one row of %s (%s.%s -> %s.%s)", ta.Name, tb.Name, ta.Name, p.a.Name, tb.Name, p.b.Name)
	default:
		c.Relationship = "many-to-many: neither side is unique, joining multiplies rows (aggregate one side first)"
		c.Notes = append(c.Notes, "no side is unique; check for duplicates or use a bridge table")
	}

	unique := 0.0
	if c.AUnique || c.BUnique {
		unique = 1
	}
	c.Confidence = 0.5*contain/100 + 0.3*p.score + 0.2*unique
	if c.AUnique && c.BUnique && p.score < 0.6 {
		// two unique id columns overlap by coincidence all the time (1..N)
		if c.Confidence > 0.35 {
			c.Confidence = 0.35
		}
		c.Notes = append(c.Notes, "both columns are unique and the names do not suggest a key: the overlap may be coincidence")
	}
	if ov == 0 {
		c.Confidence = 0
		c.Notes = append(c.Notes, "no values in common")
	}
	c.Confidence = float64(int(c.Confidence*100+0.5)) / 100
	if c.OrphanARows > 0 || c.OrphanBRows > 0 {
		c.Notes = append(c.Notes, fmt.Sprintf("%d rows of %s and %d rows of %s have no match (an inner join drops them; use LEFT JOIN to keep them)", orA, ta.Name, orB, tb.Name))
	}
	return c, nil
}

func tableByName(ts []duck.TableInfo, name string) *duck.TableInfo {
	for i := range ts {
		if ts[i].Name == name {
			return &ts[i]
		}
	}
	return nil
}

// RelateTables ranks the column pairs that most likely link two tables.
func RelateTables(ctx context.Context, db *duck.DB, nameA, nameB string, perPair int) (map[string]any, error) {
	ts, err := db.Tables(ctx)
	if err != nil {
		return nil, err
	}
	ta, tb := tableByName(ts, nameA), tableByName(ts, nameB)
	if ta == nil {
		return nil, fmt.Errorf("unknown table %q (use list_tables)", nameA)
	}
	if tb == nil {
		return nil, fmt.Errorf("unknown table %q (use list_tables)", nameB)
	}
	var cands []*Candidate
	for _, p := range candidatePairs(ta, tb, 10) {
		c, err := evaluate(ctx, db, ta, tb, p)
		if err != nil {
			continue // an incomparable pair must not hide the others
		}
		cands = append(cands, c)
	}
	sort.SliceStable(cands, func(i, j int) bool { return cands[i].Confidence > cands[j].Confidence })
	if perPair > 0 && len(cands) > perPair {
		cands = cands[:perPair]
	}
	out := map[string]any{
		"table_a":    map[string]any{"name": ta.Name, "rows": ta.Rows, "columns": ta.Columns},
		"table_b":    map[string]any{"name": tb.Name, "rows": tb.Rows, "columns": tb.Columns},
		"candidates": cands,
	}
	switch {
	case len(cands) == 0:
		out["summary"] = "no comparable columns found; the tables may not be directly related. Try explore_table on each and look for a third table that links them."
	case cands[0].Confidence >= 0.7:
		out["summary"] = "likely link: " + cands[0].Relationship
	case cands[0].Confidence >= 0.4:
		out["summary"] = "possible link, verify before relying on it: " + cands[0].Relationship
	default:
		out["summary"] = "no convincing link; the best candidate is weak"
	}
	return out, nil
}

// SuggestJoins looks across every pair of saved tables.
func SuggestJoins(ctx context.Context, db *duck.DB) (map[string]any, error) {
	ts, err := db.Tables(ctx)
	if err != nil {
		return nil, err
	}
	if len(ts) > 25 {
		ts = ts[:25]
	}
	type link struct {
		TableA string     `json:"table_a"`
		TableB string     `json:"table_b"`
		Best   *Candidate `json:"best"`
	}
	var links []link
	for i := range ts {
		for j := i + 1; j < len(ts); j++ {
			var best *Candidate
			for _, p := range candidatePairs(&ts[i], &ts[j], 4) {
				c, err := evaluate(ctx, db, &ts[i], &ts[j], p)
				if err == nil && (best == nil || c.Confidence > best.Confidence) {
					best = c
				}
			}
			if best != nil && best.Confidence >= 0.4 {
				links = append(links, link{ts[i].Name, ts[j].Name, best})
			}
		}
	}
	sort.SliceStable(links, func(i, j int) bool { return links[i].Best.Confidence > links[j].Best.Confidence })
	return map[string]any{"tables": len(ts), "links": links}, nil
}

type columnInsight struct {
	Name      string  `json:"name"`
	Type      string  `json:"type"`
	NonNull   int64   `json:"non_null"`
	NullPct   float64 `json:"null_pct"`
	Distinct  int64   `json:"distinct"`
	Min       any     `json:"min"`
	Max       any     `json:"max"`
	Role      string  `json:"role"`
	TopValues []any   `json:"top_values,omitempty"`
}

// ExploreTable profiles every column in one call and guesses what each is for.
func ExploreTable(ctx context.Context, db *duck.DB, name string) (map[string]any, error) {
	ts, err := db.Tables(ctx)
	if err != nil {
		return nil, err
	}
	t := tableByName(ts, name)
	if t == nil {
		return nil, fmt.Errorf("unknown table %q (use list_tables)", name)
	}
	cols := t.Columns
	if len(cols) > 60 {
		cols = cols[:60]
	}
	var sel []string
	for _, c := range cols {
		q := quote(c.Name)
		sel = append(sel, fmt.Sprintf("count(%s)", q), fmt.Sprintf("count(distinct %s)", q), fmt.Sprintf("min(%s)::varchar", q), fmt.Sprintf("max(%s)::varchar", q))
	}
	r, err := db.ReadOnlyQuery(ctx, "select count(*), "+strings.Join(sel, ", ")+" from "+quote(name), 1)
	if err != nil {
		return nil, err
	}
	row := r.Rows[0]
	total := num(row[0])
	var insights []columnInsight
	var keys []string
	for i, c := range cols {
		base := 1 + i*4
		in := columnInsight{Name: c.Name, Type: c.Type, NonNull: num(row[base]), Distinct: num(row[base+1]), Min: row[base+2], Max: row[base+3]}
		if total > 0 {
			in.NullPct = pct(total-in.NonNull, total)
		}
		f := familyOf(c.Type)
		lname := strings.ToLower(c.Name)
		switch {
		case total > 0 && in.NonNull == total && in.Distinct == total && f != famBool:
			in.Role = "unique key candidate"
			keys = append(keys, c.Name)
		case in.NonNull == 0:
			in.Role = "empty"
		case in.Distinct <= 1:
			in.Role = "constant"
		case f == famTime:
			in.Role = "timestamp/date"
		case strings.HasSuffix(lname, "_id") || strings.HasSuffix(lname, "_key") || strings.HasSuffix(lname, "_code"):
			in.Role = "foreign key candidate"
		case in.Distinct <= 20 || (total > 0 && float64(in.Distinct)/float64(total) < 0.05 && in.Distinct <= 100):
			in.Role = "category"
		case f == famNum:
			in.Role = "measure"
		default:
			in.Role = "free text / high-cardinality"
		}
		if in.Role == "category" || in.Role == "foreign key candidate" && in.Distinct <= 20 {
			top, err := db.ReadOnlyQuery(ctx, fmt.Sprintf("select %[1]s::varchar v, count(*) n from %[2]s where %[1]s is not null group by 1 order by n desc, 1 limit 8", quote(c.Name), quote(name)), 8)
			if err == nil {
				for _, tr := range top.Rows {
					in.TopValues = append(in.TopValues, map[string]any{"value": tr[0], "rows": tr[1]})
				}
			}
		}
		insights = append(insights, in)
	}
	return map[string]any{
		"table": name, "rows": total, "source": map[string]any{"connection": t.SourceConn, "kind": t.SourceKind, "sql": t.SourceSQL, "saved_at": t.CreatedAt},
		"candidate_keys": keys, "columns": insights,
		"tip": "use relate_tables to find how this table links to another one, or suggest_joins to scan every pair",
	}, nil
}
