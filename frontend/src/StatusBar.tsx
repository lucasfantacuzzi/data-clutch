import {Icon} from './Icons'
import {baseName} from './FileTree'
import {Result, Tab} from './types'

interface Props {
    nLive: number
    nTables: number
    root: string
    tab?: Tab
    connName: string
    live: boolean
    result?: Result
    mcp: {running: boolean; port: number}
    msg: string
    onClearMsg: () => void
    onOpenSettings: () => void
}

export function StatusBar({nLive, nTables, root, tab, connName, live, result, mcp, msg, onClearMsg, onOpenSettings}: Props) {
    const hasRows = !!result && result.columns.length > 0
    return (
        <div className="statusbar">
            <span className="sb-item"><span className={`dot ${nLive ? 'ready' : 'closed'}`}/>{nLive} active connection{nLive === 1 ? '' : 's'}</span>
            <span className="sb-item"><Icon name="duckdb" size={12}/>{nTables} saved table{nTables === 1 ? '' : 's'}</span>
            {root && <span className="sb-item" title={root}><Icon name="folder" size={12}/>{baseName(root)}</span>}
            {tab && <span className="sb-item" title={tab.filePath ?? tab.title}>
                <span className={`dot ${live || tab.kind === 'duck' ? 'ready' : 'closed'}`}/>{connName}
            </span>}
            {result && !tab?.running && (
                <span className="sb-item">{hasRows ? `${result.rows.length} row${result.rows.length === 1 ? '' : 's'}${result.truncated ? '+' : ''}` : result.message || 'OK'} · {result.elapsedMs} ms</span>
            )}
            <span className="spacer"/>
            {msg && <button className="sb-item sb-err" title="Click to dismiss" onClick={onClearMsg}><Icon name="alert" size={12} color="currentColor"/><span className="sb-msg">{msg}</span><Icon name="close" size={10}/></button>}
            <button className="sb-item sb-btn" title="MCP server settings" onClick={onOpenSettings}>
                <span className={`dot ${mcp.running ? 'ready' : 'closed'}`}/>MCP {mcp.running ? `:${mcp.port}` : 'off'}
            </button>
        </div>
    )
}
