import {useEffect, useState} from 'react'
import {GetMcpInfo, RegenerateMcpToken, SetMcp} from '../wailsjs/go/main/App'

interface Info { enabled: boolean; running: boolean; port: number; url: string; token: string; error?: string; command: string; json: string }

export function McpDialog({onClose}: {onClose: () => void}) {
    const [info, setInfo] = useState<Info | null>(null)
    const [port, setPort] = useState(7733)
    const [copied, setCopied] = useState('')

    useEffect(() => { GetMcpInfo().then(i => { setInfo(i as Info); setPort(i.port) }) }, [])
    if (!info) return null

    const copy = async (what: string, text: string) => {
        try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1500) } catch { /* clipboard blocked */ }
    }
    const toggle = async (on: boolean) => setInfo(await SetMcp(on, port) as Info)

    return (
        <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className="dialog" style={{width: 640}}>
                <h2>MCP server</h2>
                <div className="body" style={{gridTemplateColumns: '110px 1fr'}}>
                    <div className="full hint">
                        Lets an AI client inspect the tables saved in the local DuckDB (read-only). It can never reach your Postgres or Redis connections.
                    </div>
                    <label>Status</label>
                    <div className="check">
                        <input id="mcp-on" type="checkbox" checked={info.enabled} onChange={e => toggle(e.target.checked)}/>
                        <label htmlFor="mcp-on" style={{color: 'var(--fg)'}}>Enabled</label>
                        <span className={`dot ${info.running ? 'ready' : ''}`} style={{marginLeft: 8}}/>
                        <span className="hint">{info.running ? 'listening on 127.0.0.1' : 'stopped'}</span>
                    </div>
                    <label>Port</label>
                    <div style={{display: 'flex', gap: 8}}>
                        <input type="number" value={port} onChange={e => setPort(Number(e.target.value))} style={{width: 110}}/>
                        <button className="btn" onClick={async () => setInfo(await SetMcp(info.enabled, port) as Info)}>Apply</button>
                    </div>
                    {info.error && <div className="full test-result fail">{info.error}</div>}
                    <label>URL</label>
                    <div className="copyrow"><code>{info.url}</code><button className="btn" onClick={() => copy('url', info.url)}>{copied === 'url' ? 'Copied' : 'Copy'}</button></div>
                    <label>Token</label>
                    <div className="copyrow"><code>{info.token}</code>
                        <button className="btn" onClick={() => copy('token', info.token)}>{copied === 'token' ? 'Copied' : 'Copy'}</button>
                        <button className="btn" title="Invalidates the old token" onClick={async () => setInfo(await RegenerateMcpToken() as Info)}>Regenerate</button>
                    </div>
                    <label>Claude Code</label>
                    <div className="copyrow"><code style={{whiteSpace: 'pre-wrap'}}>{info.command}</code><button className="btn" onClick={() => copy('cmd', info.command)}>{copied === 'cmd' ? 'Copied' : 'Copy'}</button></div>
                    <label>Other clients</label>
                    <div className="copyrow"><pre>{info.json}</pre><button className="btn" onClick={() => copy('json', info.json)}>{copied === 'json' ? 'Copied' : 'Copy'}</button></div>
                    <div className="full hint">
                        Tools: list_tables, describe_table, table_origin, sample_rows, summarize_table, column_profile, query (read-only SQL).
                    </div>
                </div>
                <div className="foot"><div className="spacer"/><button className="btn primary" onClick={onClose}>Close</button></div>
            </div>
        </div>
    )
}
