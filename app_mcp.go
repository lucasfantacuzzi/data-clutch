package main

import (
	"fmt"
	"log/slog"
	"strconv"

	"data-clutch/internal/mcpsrv"
	"data-clutch/internal/store"
)

type McpInfo struct {
	Enabled bool   `json:"enabled"`
	Running bool   `json:"running"`
	Port    int    `json:"port"`
	URL     string `json:"url"`
	Token   string `json:"token"`
	Error   string `json:"error,omitempty"`
	Command string `json:"command"` // Claude Code one-liner
	JSON    string `json:"json"`    // generic client config
}

func (a *App) startMCP(st store.Settings) {
	a.stopMCP()
	srv, err := mcpsrv.Start("127.0.0.1:"+strconv.Itoa(st.McpPort), st.McpToken, a.duck)
	a.mu.Lock()
	defer a.mu.Unlock()
	if err != nil {
		a.mcpErr = err.Error()
		slog.Error("mcp: start failed", "port", st.McpPort, "err", err)
		return
	}
	a.mcp, a.mcpErr = srv, ""
}

func (a *App) stopMCP() {
	a.mu.Lock()
	srv := a.mcp
	a.mcp = nil
	a.mu.Unlock()
	if srv != nil {
		srv.Stop()
	}
}

func (a *App) mcpInfo() *McpInfo {
	st := a.store.Settings()
	a.mu.Lock()
	defer a.mu.Unlock()
	url := fmt.Sprintf("http://127.0.0.1:%d/mcp", st.McpPort)
	info := &McpInfo{Enabled: st.McpEnabled, Running: a.mcp != nil, Port: st.McpPort, URL: url, Token: st.McpToken, Error: a.mcpErr}
	info.Command = fmt.Sprintf(`claude mcp add --transport http data-clutch %s --header "Authorization: Bearer %s"`, url, st.McpToken)
	info.JSON = fmt.Sprintf("{\n  \"mcpServers\": {\n    \"data-clutch\": {\n      \"type\": \"http\",\n      \"url\": %q,\n      \"headers\": { \"Authorization\": \"Bearer %s\" }\n    }\n  }\n}", url, st.McpToken)
	return info
}

func (a *App) GetMcpInfo() *McpInfo {
	// make sure a token exists so the snippets are usable before enabling
	if _, err := a.store.UpdateSettings(func(*store.Settings) {}); err != nil {
		slog.Error("settings: ensure token failed", "err", err)
	}
	return a.mcpInfo()
}

func (a *App) SetMcp(enabled bool, port int) *McpInfo {
	if port != 0 && (port < 1024 || port > 65535) {
		a.mu.Lock()
		a.mcpErr = fmt.Sprintf("invalid port %d (use 1024-65535)", port)
		a.mu.Unlock()
		return a.mcpInfo()
	}
	st, err := a.store.UpdateSettings(func(s *store.Settings) {
		s.McpEnabled = enabled
		if port > 0 {
			s.McpPort = port
		}
	})
	if err != nil {
		slog.Error("settings: save failed", "err", err)
	}
	if enabled {
		a.startMCP(st)
	} else {
		a.stopMCP()
		a.mu.Lock()
		a.mcpErr = ""
		a.mu.Unlock()
	}
	return a.mcpInfo()
}

func (a *App) RegenerateMcpToken() *McpInfo {
	st, err := a.store.UpdateSettings(func(s *store.Settings) { s.McpToken = store.NewToken() })
	if err != nil {
		slog.Error("settings: token regeneration failed", "err", err)
	}
	if st.McpEnabled {
		a.startMCP(st)
	}
	return a.mcpInfo()
}
