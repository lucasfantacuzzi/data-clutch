package main

import (
	"fmt"
	"strconv"

	"data-clutch/internal/mcpsrv"
	"data-clutch/internal/store"
)

type McpInfo struct {
	Enabled  bool   `json:"enabled"`
	Running  bool   `json:"running"`
	Port     int    `json:"port"`
	URL      string `json:"url"`
	Token    string `json:"token"`
	Error    string `json:"error,omitempty"`
	Command  string `json:"command"`  // Claude Code one-liner
	JSON     string `json:"json"`     // generic client config
	Insecure bool   `json:"insecure"` // secrets are in the plaintext fallback file (no OS keyring)
}

func (a *App) startMCP(st store.Settings) {
	a.stopMCP()
	srv, err := mcpsrv.Start("127.0.0.1:"+strconv.Itoa(st.McpPort), st.McpToken, a.duck)
	a.mu.Lock()
	defer a.mu.Unlock()
	if err != nil {
		a.mcpErr = err.Error()
		a.reportErr("mcp", fmt.Sprintf("MCP server failed to start on port %d", st.McpPort), err)
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
	// The UI only ever sees a masked token; McpSecret returns the real text for copying.
	masked := maskToken(st.McpToken)
	info := &McpInfo{Enabled: st.McpEnabled, Running: a.mcp != nil, Port: st.McpPort, URL: url, Token: masked, Error: a.mcpErr, Insecure: a.store.InsecureSecrets()}
	info.Command, info.JSON = mcpSnippets(url, masked)
	return info
}

func maskToken(t string) string {
	if len(t) <= 4 {
		return "••••"
	}
	return "••••••••" + t[len(t)-4:]
}

func mcpSnippets(url, token string) (cmd, js string) {
	cmd = fmt.Sprintf(`claude mcp add --transport http data-clutch %s --header "Authorization: Bearer %s"`, url, token)
	js = fmt.Sprintf("{\n  \"mcpServers\": {\n    \"data-clutch\": {\n      \"type\": \"http\",\n      \"url\": %q,\n      \"headers\": { \"Authorization\": \"Bearer %s\" }\n    }\n  }\n}", url, token)
	return
}

// McpSecret returns the real text to copy: "token", "cmd" or "json".
func (a *App) McpSecret(what string) string {
	st := a.store.Settings()
	url := fmt.Sprintf("http://127.0.0.1:%d/mcp", st.McpPort)
	cmd, js := mcpSnippets(url, st.McpToken)
	switch what {
	case "url":
		return url
	case "token":
		return st.McpToken
	case "cmd":
		return cmd
	case "json":
		return js
	}
	return ""
}

func (a *App) GetMcpInfo() *McpInfo {
	// make sure a token exists so the snippets are usable before enabling
	if _, err := a.store.UpdateSettings(func(*store.Settings) {}); err != nil {
		a.reportErr("settings", "could not save the MCP token", err)
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
		a.reportErr("settings", "could not save MCP settings", err)
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
		a.reportErr("settings", "could not save the new MCP token", err)
	}
	if st.McpEnabled {
		a.startMCP(st)
	}
	return a.mcpInfo()
}
