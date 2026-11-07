# data-clutch

A DataGrip-style client for PostgreSQL and Redis servers that allow **one session at a time**.

- One connection per database, owned by a single goroutine (`internal/conn`): jobs are queued, keepalive pings run when idle, and a dead connection is re-dialed with backoff, never in parallel.
- Connections are read-only by default (Postgres `READ ONLY` transactions, Redis allowlist from `COMMAND INFO`).
- Query results can be saved to a local DuckDB (`~/.config/data-clutch/data.duckdb`); an embedded MCP server exposes only those tables, read-only.

## Run

```
docker compose up -d          # optional: Postgres on :55432 (pw "clutch"), Redis on :56379
wails dev -tags webkit2_41    # or: wails build -tags webkit2_41
```

Tests: `CLUTCH_PG=localhost:55432 CLUTCH_REDIS=localhost:56379 go test -race ./...`

## MCP

Toolbar → **MCP** → enable, then copy the `claude mcp add ...` command. Tools: `list_tables`, `describe_table`, `table_origin`, `sample_rows`, `summarize_table`, `column_profile`, `query`.
