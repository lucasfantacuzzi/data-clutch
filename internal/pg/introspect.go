package pg

import (
	"context"

	"github.com/jackc/pgx/v5"
)

type Column struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	NotNull  bool   `json:"notNull"`
	Default  string `json:"default,omitempty"`
	Position int    `json:"position"`
	PK       bool   `json:"pk,omitempty"`
}

type Index struct {
	Name    string `json:"name"`
	Def     string `json:"def"`
	Unique  bool   `json:"unique"`
	Primary bool   `json:"primary"`
}

type Constraint struct {
	Name string `json:"name"`
	Type string `json:"type"` // p,f,u,c,x
	Def  string `json:"def"`
}

type Table struct {
	Name        string       `json:"name"`
	Kind        string       `json:"kind"` // table, view, matview, foreign, partitioned
	Comment     string       `json:"comment,omitempty"`
	Columns     []Column     `json:"columns"`
	Indexes     []Index      `json:"indexes"`
	Constraints []Constraint `json:"constraints"`
}

type Function struct {
	Name string `json:"name"`
	Args string `json:"args"`
}

type SchemaNode struct {
	Name      string     `json:"name"`
	Tables    []*Table   `json:"tables"`
	Functions []Function `json:"functions"`
}

type Schema struct {
	Database string        `json:"database"`
	Schemas  []*SchemaNode `json:"schemas"`
}

var relKinds = map[string]string{"r": "table", "v": "view", "m": "matview", "f": "foreign", "p": "partitioned"}

func introspect(ctx context.Context, c *pgx.Conn) (*Schema, error) {
	// Only user schemas; pg_catalog/information_schema are noise in the tree.
	const schemaFilter = `n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'`

	out := &Schema{}
	if err := c.QueryRow(ctx, "select current_database()").Scan(&out.Database); err != nil {
		return nil, err
	}

	bySchema := map[string]*SchemaNode{}
	rows, err := c.Query(ctx, `select nspname from pg_namespace n where `+schemaFilter+` order by 1`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		sn := &SchemaNode{Name: n, Tables: []*Table{}, Functions: []Function{}}
		bySchema[n] = sn
		out.Schemas = append(out.Schemas, sn)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	type key struct{ s, t string }
	tables := map[key]*Table{}

	rows, err = c.Query(ctx, `
select n.nspname, c.relname, c.relkind::text, coalesce(obj_description(c.oid,'pg_class'),'')
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where `+schemaFilter+` and c.relkind in ('r','v','m','f','p') and not c.relispartition
order by 1,2`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var s, n, k, cm string
		if err := rows.Scan(&s, &n, &k, &cm); err != nil {
			return nil, err
		}
		t := &Table{Name: n, Kind: relKinds[k], Comment: cm, Columns: []Column{}, Indexes: []Index{}, Constraints: []Constraint{}}
		tables[key{s, n}] = t
		bySchema[s].Tables = append(bySchema[s].Tables, t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows, err = c.Query(ctx, `
select n.nspname, c.relname, a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull,
       coalesce(pg_get_expr(d.adbin,d.adrelid),''), a.attnum::int
from pg_attribute a
join pg_class c on c.oid=a.attrelid
join pg_namespace n on n.oid=c.relnamespace
left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where `+schemaFilter+` and c.relkind in ('r','v','m','f','p') and a.attnum>0 and not a.attisdropped
order by 1,2,a.attnum`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var s, t string
		var col Column
		if err := rows.Scan(&s, &t, &col.Name, &col.Type, &col.NotNull, &col.Default, &col.Position); err != nil {
			return nil, err
		}
		if tb := tables[key{s, t}]; tb != nil {
			tb.Columns = append(tb.Columns, col)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows, err = c.Query(ctx, `
select n.nspname, t.relname, i.relname, pg_get_indexdef(x.indexrelid), x.indisunique, x.indisprimary
from pg_index x
join pg_class t on t.oid=x.indrelid
join pg_class i on i.oid=x.indexrelid
join pg_namespace n on n.oid=t.relnamespace
where `+schemaFilter+`
order by 1,2,3`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var s, t string
		var ix Index
		if err := rows.Scan(&s, &t, &ix.Name, &ix.Def, &ix.Unique, &ix.Primary); err != nil {
			return nil, err
		}
		if tb := tables[key{s, t}]; tb != nil {
			tb.Indexes = append(tb.Indexes, ix)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows, err = c.Query(ctx, `
select n.nspname, t.relname, co.conname, co.contype::text, pg_get_constraintdef(co.oid), co.conkey::int[]
from pg_constraint co
join pg_class t on t.oid=co.conrelid
join pg_namespace n on n.oid=t.relnamespace
where `+schemaFilter+` and co.contype in ('p','f','u','c','x')
order by 1,2,3`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var s, t string
		var cn Constraint
		var keys []int32
		if err := rows.Scan(&s, &t, &cn.Name, &cn.Type, &cn.Def, &keys); err != nil {
			return nil, err
		}
		tb := tables[key{s, t}]
		if tb == nil {
			continue
		}
		tb.Constraints = append(tb.Constraints, cn)
		if cn.Type == "p" {
			for _, k := range keys {
				for i := range tb.Columns {
					if tb.Columns[i].Position == int(k) {
						tb.Columns[i].PK = true
					}
				}
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows, err = c.Query(ctx, `
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where `+schemaFilter+` and p.prokind in ('f','p')
order by 1,2`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var s string
		var f Function
		if err := rows.Scan(&s, &f.Name, &f.Args); err != nil {
			return nil, err
		}
		bySchema[s].Functions = append(bySchema[s].Functions, f)
	}
	return out, rows.Err()
}
