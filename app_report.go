package main

import (
	"log/slog"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// appError is the payload of the "app:error" event shown in the Output panel.
type appError struct {
	Source string `json:"source"`
	Text   string `json:"text"`
}

// reportErr logs err and forwards it to the UI. Before startup there is no UI, so it only logs.
func (a *App) reportErr(source, msg string, err error) {
	slog.Error(msg, "source", source, "err", err)
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "app:error", appError{Source: source, Text: msg + ": " + err.Error()})
}
