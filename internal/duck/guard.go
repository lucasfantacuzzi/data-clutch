package duck

// The MCP server's read-only path: one statement, read keywords only, run in a
// READ ONLY transaction. See ReadOnlyQuery.

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"data-clutch/internal/result"
)

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
