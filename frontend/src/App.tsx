import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
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
    const [saveTab, setSaveTab] = useState<Tab | null>(null)
    const [msg, setMsg] = useState('')
    const [toast, setToast] = useState('')
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
            if (a === 'delete' && confirm(`Delete connection "${cfg.name}"?`)) {
                setTabs(ts => ts.filter(t => t.connId !== cfg.id))
                await DeleteConnection(cfg.id); await reload()
            }
        } catch (e) { setMsg(String(e)) }
    }

    const duckOpen = (t: DuckTable) =>
        openTab({title: t.name, connId: 'duck', kind: 'duck', sql: `select * from ${q(t.name)} limit 200;`, autoRun: true})
    const duckConsole = () => openTab({title: 'DuckDB console', connId: 'duck', kind: 'duck', sql: duck[0] ? `select * from ${q(duck[0].name)} limit 100;` : ''})
    const duckDrop = async (t: DuckTable) => {
        setMenu(null)
        if (!confirm(`Drop DuckDB table "${t.name}"? This cannot be undone.`)) return
        try { await DuckDrop(t.name); await reloadDuck() } catch (e) { setMsg(String(e)) }
    }

    const activeTab = tabs.find(t => t.id === active)
    const nLive = Object.values(statuses).filter(s => s.state !== 'closed').length
    const duckSch = useMemo(() => duckSchema(duck), [duck])

    const nameOf = (t: Tab) => (t.kind === 'duck' ? 'Local DuckDB' : cfgOf(t.connId)?.name ?? 'deleted connection')

    return (
        <div className="app" onClick={() => setMenu(null)}>
            <div className="main">
                <div className="sidebar">
                    <div className="sidebar-head">
                        <span>Database</span><span className="spacer"/>
                        <button className="icon-btn" title="New connection" onClick={() => setDialog(emptyConfig())}>＋</button>
                        <button className="icon-btn" title="DuckDB console" onClick={duckConsole}>🦆</button>
                        <button className="icon-btn" title="MCP server" onClick={() => setMcpOpen(true)}>MCP</button>
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
                    <div className="tabs">
                        {tabs.map(t => (
                            <div key={t.id} className={`tab ${t.id === active ? 'active' : ''}`} onClick={() => setActive(t.id)}
                                 onAuxClick={e => e.button === 1 && closeTab(t.id)}>
                                {t.running && <span className="tdot"/>}
                                <span>{t.title}</span>
                                <button className="x" onClick={e => { e.stopPropagation(); closeTab(t.id) }}>×</button>
                            </div>
                        ))}
                    </div>
                    {tabs.length === 0 && (
                        <div className="welcome">
                            <div style={{fontSize: 16, color: 'var(--fg)'}}>data-clutch</div>
                            <div>Double-click a connection to connect, then a table or key to open it.</div>
                            <div>Right-click a connection for a new console.</div>
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
                                     onSave={() => setSaveTab(t)}/>
                        </div>
                    ))}
                </div>
            </div>
            <div className="statusbar">
                <span>{nLive} active connection{nLive === 1 ? '' : 's'}</span>
                <span>{duck.length} saved table{duck.length === 1 ? '' : 's'}</span>
                {msg && <span style={{color: 'var(--err)', cursor: 'pointer'}} title="Click to dismiss" onClick={() => setMsg('')}>{msg}</span>}
            </div>

            {menu?.cfg && (() => {
                const cfg = menu.cfg!
                const st = statuses[cfg.id]
                const live = !!st && st.state !== 'closed'
                return (
                    <div className="menu" style={{left: menu.x, top: menu.y}} onClick={e => e.stopPropagation()}>
                        {!live && <div onClick={() => doMenu('connect', cfg)}>Connect</div>}
                        {live && <div onClick={() => doMenu('console', cfg)}>New console</div>}
                        {live && <div onClick={() => doMenu('refresh', cfg)}>{cfg.kind === 'redis' ? 'Reload keys' : 'Refresh schema'}</div>}
                        {st?.state === 'reconnecting' && <div onClick={() => doMenu('retry', cfg)}>Retry now</div>}
                        {live && <div onClick={() => doMenu('disconnect', cfg)}>Disconnect</div>}
                        <hr/>
                        <div onClick={() => doMenu('edit', cfg)}>Edit…</div>
                        <div className="danger" onClick={() => doMenu('delete', cfg)}>Delete</div>
                    </div>
                )
            })()}
            {menu?.duck && (
                <div className="menu" style={{left: menu.x, top: menu.y}} onClick={e => e.stopPropagation()}>
                    <div onClick={() => { setMenu(null); duckOpen(menu.duck!) }}>Open data</div>
                    <div className="danger" onClick={() => duckDrop(menu.duck!)}>Drop table…</div>
                </div>
            )}

            {dialog && <ConnectionDialog initial={dialog} onClose={() => setDialog(null)} onSaved={async () => { setDialog(null); await reload() }}/>}
            {mcpOpen && <McpDialog onClose={() => setMcpOpen(false)}/>}
            {saveTab && saveTab.ranSql && (
                <SaveDialog connId={saveTab.connId} connName={nameOf(saveTab)} sql={saveTab.ranSql}
                            onClose={() => setSaveTab(null)}
                            onSaved={(table, rows) => { setSaveTab(null); reloadDuck(); flash(`Saved ${rows} row${rows === 1 ? '' : 's'} to DuckDB table "${table}"`) }}/>
            )}
            {toast && <div className="toast">{toast}</div>}
        </div>
    )
}
