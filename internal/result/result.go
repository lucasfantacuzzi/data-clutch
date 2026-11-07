// Package result is the shared tabular shape every driver returns to the UI.
package result

type Col struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type Result struct {
	Columns   []Col   `json:"columns"`
	Rows      [][]any `json:"rows"`
	Truncated bool    `json:"truncated"`
	Message   string  `json:"message,omitempty"` // e.g. "INSERT 0 3" for statements without rows
	ElapsedMs int64   `json:"elapsedMs"`
}

func New(cols ...string) *Result {
	r := &Result{Columns: make([]Col, len(cols)), Rows: [][]any{}}
	for i, c := range cols {
		r.Columns[i] = Col{Name: c}
	}
	return r
}
