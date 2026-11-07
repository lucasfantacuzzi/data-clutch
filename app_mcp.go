package main

import (
	"fmt"
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
	a.store.UpdateSettings(func(*store.Settings) {})
	return a.mcpInfo()
}

func (a *App) SetMcp(enabled bool, port int) *McpInfo {
	st, _ := a.store.UpdateSettings(func(s *store.Settings) {
		s.McpEnabled = enabled
		if port > 0 {
			s.McpPort = port
		}
	})
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
	st, _ := a.store.UpdateSettings(func(s *store.Settings) { s.McpToken = store.NewToken() })
	if st.McpEnabled {
		a.startMCP(st)
	}
	return a.mcpInfo()
}
