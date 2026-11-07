import {useEffect, useState} from 'react'
import {GetMcpInfo, RegenerateMcpToken, SetMcp} from '../wailsjs/go/main/App'
import {Dialog, Notice} from './Dialog'
import {Icon} from './Icons'

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

    const copyBtn = (what: string, text: string) => (
        <button className="btn sm" onClick={() => copy(what, text)}>
            <Icon name={copied === what ? 'check' : 'copy'} size={13}/>{copied === what ? 'Copied' : 'Copy'}
        </button>
    )

    return (
        <Dialog title="MCP server" icon="gear" width={640} onClose={onClose}
                footer={<><div className="spacer"/><button className="btn primary" onClick={onClose}>Close</button></>}>
            <div className="body" style={{gridTemplateColumns: '110px 1fr'}}>
                <div className="full hint">
                    Lets an AI client inspect the tables saved in the local DuckDB (read-only). It can never reach your Postgres or Redis connections.
                </div>
                <span className="lbl">Status</span>
                <div className="check-row">
                    <label className="check" htmlFor="mcp-on">
                        <input id="mcp-on" type="checkbox" checked={info.enabled} onChange={e => toggle(e.target.checked)}/>
                        Enabled
                    </label>
                    <span className={`dot ${info.running ? 'ready' : ''}`}/>
                    <span className="hint">{info.running ? 'listening on 127.0.0.1' : 'stopped'}</span>
                </div>
                <label htmlFor="mcp-port">Port</label>
                <div className="inline">
                    <input id="mcp-port" type="number" value={port} onChange={e => setPort(Number(e.target.value))} style={{width: 110}}/>
                    <button className="btn" onClick={async () => setInfo(await SetMcp(info.enabled, port) as Info)}>Apply</button>
                </div>
                {info.error && <Notice kind="fail">{info.error}</Notice>}
                <span className="lbl">URL</span>
                <div className="copyrow"><code>{info.url}</code>{copyBtn('url', info.url)}</div>
                <span className="lbl">Token</span>
                <div className="copyrow"><code>{info.token}</code>
                    {copyBtn('token', info.token)}
                    <button className="btn sm" title="Invalidates the old token" onClick={async () => setInfo(await RegenerateMcpToken() as Info)}><Icon name="refresh" size={13}/>Regenerate</button>
                </div>
                <span className="lbl">Claude Code</span>
                <div className="copyrow"><code style={{whiteSpace: 'pre-wrap'}}>{info.command}</code>{copyBtn('cmd', info.command)}</div>
                <span className="lbl">Other clients</span>
                <div className="copyrow"><pre>{info.json}</pre>{copyBtn('json', info.json)}</div>
                <div className="full hint">
                    Tools: list_tables, describe_table, table_origin, sample_rows, summarize_table, column_profile, query (read-only SQL).
                </div>
            </div>
        </Dialog>
    )
}
