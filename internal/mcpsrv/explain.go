package mcpsrv

import (
	"context"
	"fmt"
	"regexp"

	"data-clutch/internal/duck"
)

const (
	DefaultSampleRows = 200
	MaxSampleRows     = 200
	maskedValue       = "***masked***"
)

var (
	sensitiveName = regexp.MustCompile(`(?i)(e[-_]?mail|cpf|cnpj|ssn|passw|senha|secret|token|api[-_]?key|credit|card|cvv|iban|phone|telefone|celular|\btel\b|address|endereco|birth|nascimento)`)
	emailValue    = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
	tokenValue    = regexp.MustCompile(`^[A-Za-z0-9_\-\.=+/]{32,}$`)
	moneyName     = regexp.MustCompile(`(?i)(amount|total|price|preco|valor|cost|custo|revenue|receita|fee|balance|saldo|salary)`)
	timestampName = regexp.MustCompile(`(?i)(_at$|_date$|_on$|^date|^created|^updated|^deleted|timestamp)`)
	quantityName  = regexp.MustCompile(`(?i)(qty|quantity|quantidade|count|^n_|_count$)`)
)

// maskedColumns finds columns that probably hold personal data or secrets, by
// name and by sniffing values in the sample.
func maskedColumns(cols []duck.Col, sample [][]any) map[string]string {
	out := map[string]string{}
	for i, c := range cols {
		if sensitiveName.MatchString(c.Name) {
			out[c.Name] = "name looks sensitive"
			continue
		}
		if familyOf(c.Type) != famText {
			continue
		}
		var n, email, token int
		for _, r := range sample {
			s, ok := r[i].(string)
			if !ok || s == "" {
				continue
			}
			n++
			if emailValue.MatchString(s) {
				email++
			}
			if tokenValue.MatchString(s) {
				token++
			}
		}
		if n >= 3 && email*2 > n {
			out[c.Name] = "values look like e-mail addresses"
		} else if n >= 3 && token*2 > n {
			out[c.Name] = "values look like tokens or keys"
		}
	}
	return out
}

func maskAny(v any) any {
	if v == nil {
		return nil
	}
	return maskedValue
}

// ExplainTable gathers everything a model needs to explain what a saved table
// is: profile, origin, a varied sample, distributions, anomalies and links to
// the other saved tables. It does not interpret anything itself.
func ExplainTable(ctx context.Context, db *duck.DB, name string, sampleRows int, mask bool) (map[string]any, error) {
	if sampleRows <= 0 || sampleRows > MaxSampleRows {
		sampleRows = MaxSampleRows
	}
	ts, err := db.Tables(ctx)
	if err != nil {
		return nil, err
	}
	t := tableByName(ts, name)
	if t == nil {
		return nil, fmt.Errorf("unknown table %q (use list_tables)", name)
	}
	profile, err := ExploreTable(ctx, db, name)
	if err != nil {
		return nil, err
	}

	// the sample is random but repeatable, so a re-run explains the same rows
	sq := fmt.Sprintf("select * from %s", quote(name))
	if t.Rows > int64(sampleRows) {
		sq += fmt.Sprintf(" using sample %d rows (reservoir, 42)", sampleRows)
	}
	sample, err := db.ReadOnlyQuery(ctx, sq, sampleRows)
	if err != nil {
		return nil, err
	}

	masked := map[string]string{}
	if mask {
		masked = maskedColumns(t.Columns, sample.Rows)
	}
	maskIdx := map[int]bool{}
	for i, c := range t.Columns {
		if _, ok := masked[c.Name]; ok {
			maskIdx[i] = true
		}
	}
	for _, r := range sample.Rows {
		for i := range r {
			if maskIdx[i] {
				r[i] = maskAny(r[i])
			}
		}
	}
	insights := profile["columns"].([]columnInsight)
	for i := range insights {
		if _, ok := masked[insights[i].Name]; ok {
			insights[i].Min, insights[i].Max = maskAny(insights[i].Min), maskAny(insights[i].Max)
			insights[i].TopValues = nil
		}
	}

	var anomalies []string
	var distributions []map[string]any
	total := t.Rows
	for _, in := range insights {
		f := familyOf(in.Type)
		switch {
		case in.Role == "empty":
			anomalies = append(anomalies, fmt.Sprintf("column %q is entirely NULL", in.Name))
		case in.Role == "constant":
			anomalies = append(anomalies, fmt.Sprintf("column %q has a single value, it carries no information", in.Name))
		case in.NullPct >= 50:
			anomalies = append(anomalies, fmt.Sprintf("column %q is %.0f%% NULL", in.Name, in.NullPct))
		}
		if _, isMasked := masked[in.Name]; isMasked {
			continue
		}
		if f == famTime {
			if r, err := db.ReadOnlyQuery(ctx, fmt.Sprintf("select min(%[1]s)::varchar, max(%[1]s)::varchar, datediff('day', min(%[1]s)::timestamp, max(%[1]s)::timestamp), count(*) filter (where %[1]s::timestamp > now()) from %[2]s", quote(in.Name), quote(name)), 1); err == nil && len(r.Rows) == 1 {
				v := r.Rows[0]
				distributions = append(distributions, map[string]any{"column": in.Name, "kind": "time range", "from": v[0], "to": v[1], "span_days": v[2], "rows_in_the_future": v[3]})
				if num(v[3]) > 0 {
					anomalies = append(anomalies, fmt.Sprintf("column %q has %d dates in the future", in.Name, num(v[3])))
				}
			}
		}
		if f == famNum && in.Role != "unique key candidate" && in.Role != "foreign key candidate" && in.Distinct > 1 {
			c := quote(in.Name)
			q := fmt.Sprintf(`with s as (select quantile_cont(%[1]s, 0.25) q1, quantile_cont(%[1]s, 0.5) med, quantile_cont(%[1]s, 0.75) q3, quantile_cont(%[1]s, 0.95) p95, avg(%[1]s) mean, stddev_samp(%[1]s) sd from %[2]s)
				select s.q1, s.med, s.q3, s.p95, s.mean, s.sd,
				  (select count(*) from %[2]s where %[1]s < s.q1 - 1.5*(s.q3-s.q1) or %[1]s > s.q3 + 1.5*(s.q3-s.q1)),
				  (select count(*) from %[2]s where %[1]s < 0)
				from s`, c, quote(name))
			if r, err := db.ReadOnlyQuery(ctx, q, 1); err == nil && len(r.Rows) == 1 {
				v := r.Rows[0]
				distributions = append(distributions, map[string]any{"column": in.Name, "kind": "numeric", "q1": v[0], "median": v[1], "q3": v[2], "p95": v[3], "mean": v[4], "stddev": v[5], "outliers_iqr": v[6], "negative_values": v[7]})
				if num(v[6]) > 0 {
					anomalies = append(anomalies, fmt.Sprintf("column %q has %d outliers beyond 1.5 IQR", in.Name, num(v[6])))
				}
				if num(v[7]) > 0 && (moneyName.MatchString(in.Name) || quantityName.MatchString(in.Name)) {
					anomalies = append(anomalies, fmt.Sprintf("column %q looks like an amount or quantity but has %d negative values (refunds? errors?)", in.Name, num(v[7])))
				}
			}
		}
	}
	if r, err := db.ReadOnlyQuery(ctx, fmt.Sprintf("select count(*) from (select 1 from %s group by all having count(*) > 1)", quote(name)), 1); err == nil && len(r.Rows) == 1 && num(r.Rows[0][0]) > 0 {
		anomalies = append(anomalies, fmt.Sprintf("%d groups of fully duplicated rows", num(r.Rows[0][0])))
	}

	// how this table connects to the others
	var links []map[string]any
	others := ts
	if len(others) > 25 {
		others = others[:25]
	}
	for i := range others {
		o := &others[i]
		if o.Name == name {
			continue
		}
		var best *Candidate
		for _, p := range candidatePairs(t, o, 4) {
			if c, err := evaluate(ctx, db, t, o, p); err == nil && (best == nil || c.Confidence > best.Confidence) {
				best = c
			}
		}
		if best != nil && best.Confidence >= 0.4 {
			links = append(links, map[string]any{"other_table": o.Name, "relationship": best.Relationship, "confidence": best.Confidence, "this_column": best.AColumn, "other_column": best.BColumn, "join_sql": best.JoinSQL})
		}
	}

	// naming clues are hints for the model, not conclusions
	var clues []string
	for _, c := range t.Columns {
		switch {
		case timestampName.MatchString(c.Name) && familyOf(c.Type) == famTime:
			clues = append(clues, fmt.Sprintf("%q is a point in time: this table probably records events", c.Name))
		case moneyName.MatchString(c.Name) && familyOf(c.Type) == famNum:
			clues = append(clues, fmt.Sprintf("%q looks monetary", c.Name))
		case quantityName.MatchString(c.Name) && familyOf(c.Type) == famNum:
			clues = append(clues, fmt.Sprintf("%q looks like a quantity", c.Name))
		}
	}

	notes := []string{
		"Everything here is evidence from the data. Any statement about what the table means in the business is an inference: say so, and cite the numbers behind it.",
		fmt.Sprintf("sample: %d of %d rows (random, repeatable)", len(sample.Rows), total),
	}
	if len(masked) > 0 {
		notes = append(notes, "columns were masked to avoid exposing personal data or secrets; reason about them by name, type and profile only")
	}
	return map[string]any{
		"table":          name,
		"rows":           total,
		"origin":         profile["source"],
		"candidate_keys": profile["candidate_keys"],
		"columns":        insights,
		"masked_columns": masked,
		"sample":         sample,
		"distributions":  distributions,
		"anomalies":      anomalies,
		"links":          links,
		"naming_clues":   clues,
		"notes":          notes,
	}, nil
}

// ExplainPrompt is the instruction text the client model receives.
func ExplainPrompt(table string) string {
	return fmt.Sprintf(`Explain the saved table %[1]q to someone who has never seen it. Work from evidence.

1. Call explain_table with table=%[1]q (and list_tables if you need the names of other tables).
2. Write the explanation with these sections:
   - What it is: what one row represents and what the table is probably used for. Use the origin SQL and connection as the strongest clue.
   - Key columns: the identifier(s), foreign keys, dates and measures, and what each means.
   - Content at a glance: row count, date range, main categories and how they are distributed, typical values of the main measures.
   - How it connects: which other saved tables it joins to, on which columns, with what cardinality, and a ready join.
   - Things to watch: nulls, duplicates, outliers, constants, negative amounts, orphaned rows, masked columns.
3. Separate facts from guesses. Every claim about the data cites a number from the tool output; anything about business meaning is labelled as an inference with the clue that supports it.
4. If something is ambiguous, say what extra query (use the query tool) would settle it, and run it if it is cheap.
5. Do not invent columns, tables or values that the tools did not return. Masked values are intentionally hidden: do not try to recover them.`, table)
}
