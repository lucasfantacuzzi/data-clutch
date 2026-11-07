import {ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {EventsOn} from '../wailsjs/runtime/runtime'
import {conn} from '../wailsjs/go/models'
import {
    CancelQuery, Connect, ConnectionStatuses, DeleteConnection, Disconnect, DuckDrop, DuckQuery, DuckTables, GetSchema,
    ListConnections, RedisScan, RefreshSchema, RetryNow, RunQuery,
} from '../wailsjs/go/main/App'
import {ConnectionDialog, emptyConfig} from './ConnectionDialog'
import {Tree} from './Tree'
import {Console} from './Console'
import {SaveDialog} from './SaveDialog'
import {McpDialog} from './McpDialog'
import {ConfirmDialog} from './ConfirmDialog'
import {Icon, IconName, kindIcon} from './Icons'
import {DuckTable, RedisKey, RedisPage, Result, Schema, Status, Tab} from './types'

const ROW_LIMIT = 1000
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2))
const q = (s: string) => `"${s.replace(/"/g, '""')}"`
const rq = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

function redisCommand(k: RedisKey): string {
    const key = rq(k.key)
    switch (k.type) {
        case 'hash': return `HGETALL ${key}`
        case 'list': return `LRANGE ${key} 0 999`
        case 'set': return `SSCAN ${key} 0 COUNT 1000`
        case 'zset': return `ZRANGE ${key} 0 999 WITHSCORES`
        case 'stream': return `XRANGE ${key} - + COUNT 1000`
        default: return `GET ${key}`
    }
}

// duck tables presented in the same shape as a Postgres schema so autocomplete is shared
function duckSchema(tables: DuckTable[]): Schema {
    return {
        database: 'duckdb',
        schemas: [{
            name: 'main', functions: [],
            tables: tables.map((t, i) => ({
                name: t.name, kind: 'table', indexes: [], constraints: [],
                columns: t.columns.map((c, j) => ({name: c.name, type: c.type.toLowerCase(), notNull: false, position: j + 1 + i * 0})),
            })),
        }],
    }
}

type MenuState = {x: number; y: number; cfg?: conn.Config; duck?: DuckTable}
type ConfirmState = {title: string; message: string; label: string; run: () => Promise<void>}

function ContextMenu({x, y, onClose, children}: {x: number; y: number; onClose: () => void; children: ReactNode}) {
    const ref = useRef<HTMLDivElement>(null)
    const [pos, setPos] = useState({left: x, top: y})
    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        setPos({left: Math.max(4, Math.min(x, window.innerWidth - el.offsetWidth - 4)), top: Math.max(4, Math.min(y, window.innerHeight - el.offsetHeight - 4))})
    }, [x, y])
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onClose])
    return <div ref={ref} className="menu" role="menu" style={pos} onClick={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}>{children}</div>
}

function MenuItem({icon, hint, danger, onClick, children}: {icon?: IconName; hint?: string; danger?: boolean; onClick: () => void; children: ReactNode}) {
    return (
        <div className={`menu-item${danger ? ' danger' : ''}`} role="menuitem" tabIndex={0} onClick={onClick}
             onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}>
            <span className="mi-ico">{icon && <Icon name={icon} size={14} color="currentColor"/>}</span>
            <span className="mi-label">{children}</span>
            {hint && <span className="mi-hint">{hint}</span>}
        </div>
    )
}

export default function App() {
    const [configs, setConfigs] = useState<conn.Config[]>([])
    const [statuses, setStatuses] = useState<Record<string, Status>>({})
    const [schemas, setSchemas] = useState<Record<string, Schema | undefined>>({})
    const [redis, setRedis] = useState<Record<string, RedisPage | undefined>>({})
    const [duck, setDuck] = useState<DuckTable[]>([])
    const [tabs, setTabs] = useState<Tab[]>([])
    const [active, setActive] = useState('')
    const [dialog, setDialog] = useState<conn.Config | null>(null)
    const [menu, setMenu] = useState<MenuState | null>(null)
    const [mcpOpen, setMcpOpen] = useState(false)
    const [saveReq, setSaveReq] = useState<{tab: Tab; sql: string} | null>(null)
    const [msg, setMsg] = useState('')
    const [toast, setToast] = useState('')
    const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
    const [, tick] = useState(0)
    const prevState = useRef<Record<string, string>>({})
    const redisRef = useRef(redis)
    redisRef.current = redis

    const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 3500) }
    const reload = useCallback(async () => setConfigs((await ListConnections()) ?? []), [])
    const reloadDuck = useCallback(async () => {
        try { setDuck(((await DuckTables()) ?? []) as DuckTable[]) } catch (e) { setMsg(String(e)) }
    }, [])

    const loadSchema = useCallback(async (id: string, refresh = false) => {
        try {
            const s = await (refresh ? RefreshSchema(id) : GetSchema(id))
            setSchemas(m => ({...m, [id]: s as unknown as Schema}))
        } catch (e) { setMsg(String(e)) }
    }, [])

    const loadKeys = useCallback(async (id: string, more = false) => {
        try {
            const cur = more ? redisRef.current[id] : undefined
            const page = (await RedisScan(id, '*', cur?.cursor ?? '0', 1000)) as RedisPage
            const seen = new Set((cur?.keys ?? []).map(k => k.key))
            const keys = [...(cur?.keys ?? []), ...page.keys.filter(k => !seen.has(k.key))]
            setRedis(m => ({...m, [id]: {...page, keys}}))
        } catch (e) { setMsg(String(e)) }
    }, [])

    const loadMeta = useCallback((cfg: conn.Config | undefined, id: string, refresh = false) => {
        if (cfg?.kind === 'redis') return loadKeys(id)
        return loadSchema(id, refresh)
    }, [loadKeys, loadSchema])

    const cfgOf = (id: string) => configs.find(c => c.id === id)
    const cfgRef = useRef(configs)
    cfgRef.current = configs

    useEffect(() => {
        reload(); reloadDuck()
        ConnectionStatuses().then(list => {
            const m = Object.fromEntries((list ?? []).map(s => [s.id, s as Status]))
            setStatuses(m)
        })
        const off = EventsOn('conn:status', (s: Status) => {
            setStatuses(m => ({...m, [s.id]: s}))
            const prev = prevState.current[s.id]
            prevState.current[s.id] = s.state
            // metadata is fetched when a session becomes ready, not on every busy<->ready flip
            if (s.state === 'ready' && prev !== 'ready' && prev !== 'busy') loadMeta(cfgRef.current.find(c => c.id === s.id), s.id)
            if (s.state === 'closed') {
                setSchemas(m => ({...m, [s.id]: undefined}))
                setRedis(m => ({...m, [s.id]: undefined}))
            }
        })
        const t = setInterval(() => tick(n => n + 1), 1000) // reconnect countdown
        return () => { off(); clearInterval(t) }
    }, [])

    const isLive = (id: string) => id === 'duck' || (!!statuses[id] && ['ready', 'busy'].includes(statuses[id].state))
    const patchTab = (id: string, patch: Partial<Tab>) => setTabs(ts => ts.map(t => (t.id === id ? {...t, ...patch} : t)))

    const openTab = (t: Omit<Tab, 'id'>) => {
        const tab: Tab = {...t, id: uid()}
        setTabs(ts => [...ts, tab]); setActive(tab.id)
    }
    const closeTab = (id: string) => {
        const t = tabs.find(x => x.id === id)
        if (t?.running && t.queryId) CancelQuery(t.queryId)
        const rest = tabs.filter(x => x.id !== id)
        setTabs(rest)
        if (active === id) setActive(rest.length ? rest[rest.length - 1].id : '')
    }

    const runTab = async (tab: Tab, sql: string) => {
        const queryId = uid()
        patchTab(tab.id, {running: true, queryId, error: undefined})
        try {
            const res = (tab.kind === 'duck' ? await DuckQuery(queryId, sql, ROW_LIMIT) : await RunQuery(tab.connId, queryId, sql, ROW_LIMIT)) as Result
            patchTab(tab.id, {running: false, result: res, ranSql: sql, error: undefined})
            if (tab.kind === 'duck') reloadDuck()
        } catch (e) {
            patchTab(tab.id, {running: false, error: String(e).replace(/^Error: /, ''), result: undefined})
        }
    }

    const consoleFor = (cfg: conn.Config) =>
        openTab({title: `${cfg.name} console`, connId: cfg.id, kind: cfg.kind as Tab['kind'], sql: cfg.kind === 'redis' ? 'PING' : ''})

    const onConnect = async (cfg: conn.Config) => {
        try {
            if (!isLive(cfg.id) && !statuses[cfg.id]) await Connect(cfg.id)
            else consoleFor(cfg)
        } catch (e) { setMsg(String(e)) }
    }

    const doMenu = async (a: string, cfg: conn.Config) => {
        setMenu(null)
        try {
            if (a === 'connect') await Connect(cfg.id)
            if (a === 'console') consoleFor(cfg)
            if (a === 'disconnect') await Disconnect(cfg.id)
            if (a === 'refresh') await loadMeta(cfg, cfg.id, true)
            if (a === 'retry') await RetryNow(cfg.id)
            if (a === 'edit') setDialog(cfg)
            if (a === 'delete') {
                setConfirmState({
                    title: 'Delete connection', message: `Delete connection "${cfg.name}"?`, label: 'Delete',
                    run: async () => {
                        setTabs(ts => ts.filter(t => t.connId !== cfg.id))
                        await DeleteConnection(cfg.id); await reload()
                    },
                })
            }
        } catch (e) { setMsg(String(e)) }
    }

    const duckOpen = (t: DuckTable) =>
        openTab({title: t.name, connId: 'duck', kind: 'duck', sql: `select * from ${q(t.name)} limit 200;`, autoRun: true})
    const duckConsole = () => openTab({title: 'DuckDB console', connId: 'duck', kind: 'duck', sql: duck[0] ? `select * from ${q(duck[0].name)} limit 100;` : ''})
    const duckDrop = (t: DuckTable) => {
        setMenu(null)
        setConfirmState({
            title: 'Drop table', message: `Drop DuckDB table "${t.name}"? This cannot be undone.`, label: 'Drop',
            run: async () => { await DuckDrop(t.name); await reloadDuck() },
        })
    }

    const activeTab = tabs.find(t => t.id === active)
    const nLive = Object.values(statuses).filter(s => s.state !== 'closed').length
    const duckSch = useMemo(() => duckSchema(duck), [duck])

    const runConfirm = async () => {
        const c = confirmState
        setConfirmState(null)
        try { await c?.run() } catch (e) { setMsg(String(e)) }
    }

    const nameOf = (t: Tab) => (t.kind === 'duck' ? 'Local DuckDB' : cfgOf(t.connId)?.name ?? 'deleted connection')

    return (
        <div className="app" onClick={() => setMenu(null)}>
            <div className="main">
                <div className="sidebar">
                    <div className="sidebar-head">
                        <span className="title">Database</span><span className="spacer"/>
                        <button className="icon-btn" title="New connection" aria-label="New connection" onClick={() => setDialog(emptyConfig())}><Icon name="plus" color="currentColor"/></button>
                        <button className="icon-btn" title="DuckDB console" aria-label="DuckDB console" onClick={duckConsole}><Icon name="duckdb"/></button>
                        <button className="icon-btn" title="MCP server" aria-label="MCP server" onClick={() => setMcpOpen(true)}><Icon name="gear" color="currentColor"/></button>
                    </div>
                    <Tree configs={configs} statuses={statuses} schemas={schemas} redis={redis} duck={duck}
                          onConnect={onConnect}
                          onMenu={(cfg, x, y) => setMenu({cfg, x, y})}
                          onOpenTable={(cfg, s, t) => openTab({title: t, connId: cfg.id, kind: 'postgres', sql: `select * from ${q(s)}.${q(t)} limit 200;`, autoRun: true})}
                          onOpenKey={(cfg, k) => openTab({title: k.key, connId: cfg.id, kind: 'redis', sql: redisCommand(k), autoRun: true})}
                          onMoreKeys={cfg => loadKeys(cfg.id, true)}
                          onDuckTable={duckOpen}
                          onDuckMenu={(t, x, y) => setMenu({duck: t, x, y})}/>
                </div>
                <div className="workspace">
                    <div className="tabs" role="tablist">
                        {tabs.map(t => (
                            <div key={t.id} className={`tab ${t.id === active ? 'active' : ''}`} role="tab" aria-selected={t.id === active} tabIndex={0} title={t.title}
                                 onClick={() => setActive(t.id)}
                                 onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setActive(t.id) } }}
                                 onAuxClick={e => e.button === 1 && closeTab(t.id)}>
                                {t.running ? <span className="tdot" title="Running"/> : <Icon name={kindIcon(t.kind)} size={14}/>}
                                <span className="tab-title">{t.title}</span>
                                <button className="x" title="Close" aria-label={`Close ${t.title}`} onClick={e => { e.stopPropagation(); closeTab(t.id) }}><Icon name="close" size={12}/></button>
                            </div>
                        ))}
                    </div>
                    {tabs.length === 0 && (
                        <div className="welcome">
                            <Icon name="logo" size={44} color="var(--text-disabled)"/>
                            <div className="welcome-title">data-clutch</div>
                            <div className="welcome-sub">Open a connection to get started</div>
                            <div className="welcome-keys">
                                <span>Connect</span><span><kbd>Double-click</kbd> a connection</span>
                                <span>Open a table or key</span><span><kbd>Double-click</kbd> it in the tree</span>
                                <span>New console</span><span><kbd>Right-click</kbd> a connection</span>
                                <span>Run a query</span><span><kbd>Ctrl</kbd><kbd>Enter</kbd></span>
                            </div>
                        </div>
                    )}
                    {/* every tab stays mounted so editor state and results survive switching */}
                    {tabs.map(t => (
                        <div key={t.id} style={{display: t.id === active ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column'}}>
                            <Console tab={t} connName={nameOf(t)} live={isLive(t.connId)}
                                     schema={t.kind === 'duck' ? duckSch : schemas[t.connId]}
                                     onChange={p => patchTab(t.id, p)}
                                     onRun={sql => runTab(t, sql)}
                                     onCancel={() => t.queryId && CancelQuery(t.queryId)}
                                     onSave={sql => setSaveReq({tab: t, sql})}/>
                        </div>
                    ))}
                </div>
            </div>
            <div className="statusbar">
                <span className="sb-item"><span className={`dot ${nLive ? 'ready' : 'closed'}`}/>{nLive} active connection{nLive === 1 ? '' : 's'}</span>
                <span className="sb-item"><Icon name="duckdb" size={12}/>{duck.length} saved table{duck.length === 1 ? '' : 's'}</span>
                <span className="spacer"/>
                {msg && <button className="sb-item sb-err" title="Click to dismiss" onClick={() => setMsg('')}><Icon name="alert" size={12} color="currentColor"/><span className="sb-msg">{msg}</span><Icon name="close" size={10}/></button>}
            </div>

            {menu?.cfg && (() => {
                const cfg = menu.cfg!
                const st = statuses[cfg.id]
                const live = !!st && st.state !== 'closed'
                return (
                    <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
                        {!live && <MenuItem icon="plug" hint="Double-click" onClick={() => doMenu('connect', cfg)}>Connect</MenuItem>}
                        {live && <MenuItem icon="play" onClick={() => doMenu('console', cfg)}>New console</MenuItem>}
                        {live && <MenuItem icon="refresh" onClick={() => doMenu('refresh', cfg)}>{cfg.kind === 'redis' ? 'Reload keys' : 'Refresh schema'}</MenuItem>}
                        {st?.state === 'reconnecting' && <MenuItem icon="refresh" onClick={() => doMenu('retry', cfg)}>Retry now</MenuItem>}
                        {live && <MenuItem icon="unplug" onClick={() => doMenu('disconnect', cfg)}>Disconnect</MenuItem>}
                        <hr/>
                        <MenuItem icon="edit" onClick={() => doMenu('edit', cfg)}>Edit…</MenuItem>
                        <MenuItem icon="trash" danger onClick={() => doMenu('delete', cfg)}>Delete</MenuItem>
                    </ContextMenu>
                )
            })()}
            {menu?.duck && (
                <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
                    <MenuItem icon="table" hint="Double-click" onClick={() => { setMenu(null); duckOpen(menu.duck!) }}>Open data</MenuItem>
                    <hr/>
                    <MenuItem icon="trash" danger onClick={() => duckDrop(menu.duck!)}>Drop table…</MenuItem>
                </ContextMenu>
            )}

            {dialog && <ConnectionDialog initial={dialog} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await reload() }}/>}
            {mcpOpen && <McpDialog onClose={() => setMcpOpen(false)}/>}
            {saveReq && (
                <SaveDialog connId={saveReq.tab.connId} connName={nameOf(saveReq.tab)} sql={saveReq.sql}
                            onClose={() => setSaveReq(null)}
                            onSaved={(table, rows) => { setSaveReq(null); reloadDuck(); flash(`Saved ${rows} row${rows === 1 ? '' : 's'} to DuckDB table "${table}"`) }}/>
            )}
            {confirmState && (
                <ConfirmDialog title={confirmState.title} message={confirmState.message} confirmLabel={confirmState.label} danger
                               onCancel={() => setConfirmState(null)} onConfirm={runConfirm}/>
            )}
            {toast && <div className="toast" role="status"><Icon name="check" color="currentColor"/>{toast}</div>}
        </div>
    )
}
