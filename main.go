package main

import (
	"embed"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

// initLogging writes structured logs to <user config dir>/data-clutch/logs/app.log,
// falling back to stderr when the file cannot be opened.
func initLogging() {
	var f *os.File
	if dir, err := os.UserConfigDir(); err == nil {
		d := filepath.Join(dir, "data-clutch", "logs")
		if os.MkdirAll(d, 0o700) == nil {
			f, _ = os.OpenFile(filepath.Join(d, "app.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
		}
	}
	if f == nil {
		f = os.Stderr
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(f, nil)))
}

func main() {
	initLogging()
	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:  "data-clutch",
		Width:  1440,
		Height: 900,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 43, G: 43, B: 43, A: 1},
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		slog.Error("wails run failed", "err", err)
		println("Error:", err.Error())
	}
}
