import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {ContextMenu, MenuItem} from './ContextMenu'
import {EventsOn} from '../wailsjs/runtime/runtime'
import {conn} from '../wailsjs/go/models'
import {
    CancelQuery, CloseFolder, Connect, ConnectionStatuses, DeleteConnection, Disconnect, DuckDrop, DuckQuery, DuckTables, GetMcpInfo,
    GetSchema, ListConnections, LoadSession, OpenFolder, PickFolder, PickOpenFile, PickSaveFile, ReadFile, RedisScan, RefreshSchema,
    RetryNow, RunQuery, SaveSession, WriteFile,
} from '../wailsjs/go/main/App'
import {ConnectionDialog, emptyConfig} from './ConnectionDialog'
import {Tree} from './Tree'
import {Console, ConsoleHandle, ConnChoice} from './Console'
import {FileTree, baseName} from './FileTree'
import {MenuBar, MenuDef} from './MenuBar'
import {Welcome} from './Welcome'
import {StatusBar} from './StatusBar'
import {OutputPanel} from './OutputPanel'
import {errText, report} from './log'
import {QuickOpen} from './QuickOpen'
import {UnsavedDialog} from './UnsavedDialog'
import {COMMANDS, Handlers, effective, fmtCombo, installShortcuts} from './keybindings'
import {getActiveEditor} from './monaco'
import {SaveDialog} from './SaveDialog'
import {SettingsDialog, Section} from './SettingsDialog'
import {usePrefs} from './prefs'
import {destructiveReason} from './sql'
import {ConfirmDialog} from './ConfirmDialog'
import {Icon, IconName, kindIcon} from './Icons'
import {DuckTable, RedisKey, RedisPage, Result, Schema, Status, Tab, isDirty} from './types'

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
type ConfirmState = {title: string; message: string; label: string; run: () => Promise<void>; cancel?: () => void}

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
    const {prefs, update, reload: reloadPrefs} = usePrefs()
    const [settingsOpen, setSettingsOpen] = useState<Section | null>(null)
    const [saveReq, setSaveReq] = useState<{tab: Tab; sql: string} | null>(null)
    const [outputOpen, setOutputOpen] = useState(false)
    const [toast, setToast] = useState('')
    const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
    const [root, setRoot] = useState('')
    const [quickOpen, setQuickOpen] = useState(false)
    const [unsaved, setUnsaved] = useState<Tab | null>(null)
    const [hidden, setHidden] = useState(false) // sidebar collapsed
    const [dragW, setDragW] = useState<number | null>(null) // sidebar width while dragging
    const [mcp, setMcp] = useState({running: false, port: 0})
    const [, tick] = useState(0)
    const tabsRef = useRef<Tab[]>([])
    const consoles = useRef<Record<string, ConsoleHandle>>({})
    const handlers = useRef<Handlers>({})
    const booted = useRef(false)
    const restored = useRef(false)
    const untitled = useRef(0)
    const prevState = useRef<Record<string, string>>({})
    const redisRef = useRef(redis)
    redisRef.current = redis

    const flash = (t: string) => { setToast(t); setTimeout(() => setToast(''), 3500) }
    const reload = useCallback(async () => setConfigs((await ListConnections()) ?? []), [])
    const reloadDuck = useCallback(async () => {
        try { setDuck(((await DuckTables()) ?? []) as DuckTable[]) } catch (e) { report(e, 'app') }
    }, [])

    const loadSchema = useCallback(async (id: string, refresh = false) => {
        try {
            const s = await (refresh ? RefreshSchema(id) : GetSchema(id))
            setSchemas(m => ({...m, [id]: s as unknown as Schema}))
        } catch (e) { report(e, 'app') }
    }, [])

    const loadKeys = useCallback(async (id: string, more = false) => {
        try {
            const cur = more ? redisRef.current[id] : undefined
            const page = (await RedisScan(id, '*', cur?.cursor ?? '0', 1000)) as RedisPage
            const seen = new Set((cur?.keys ?? []).map(k => k.key))
            const keys = [...(cur?.keys ?? []), ...page.keys.filter(k => !seen.has(k.key))]
            setRedis(m => ({...m, [id]: {...page, keys}}))
        } catch (e) { report(e, 'app') }
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

    tabsRef.current = tabs
    const activeTab = tabs.find(t => t.id === active)
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
            const res = (tab.kind === 'duck' ? await DuckQuery(queryId, sql, prefs.rowLimit) : await RunQuery(tab.connId, queryId, sql, prefs.rowLimit)) as Result
            patchTab(tab.id, {running: false, result: res, ranSql: sql, error: undefined})
            if (tab.kind === 'duck') reloadDuck()
        } catch (e) {
            patchTab(tab.id, {running: false, error: String(e).replace(/^Error: /, ''), result: undefined})
        }
    }

    // destructive statements ask first (Settings > Query)
    const requestRun = (tab: Tab, sql: string) => {
        const why = prefs.confirmDestructive ? destructiveReason(sql, tab.kind) : null
        if (!why) { runTab(tab, sql); return }
        setConfirmState({title: 'Run destructive statement?', message: `${why}\n\n${sql.length > 300 ? sql.slice(0, 300) + '…' : sql}`, label: 'Run', run: () => runTab(tab, sql)})
    }

    const consoleFor = (cfg: conn.Config) =>
        openTab({title: `${cfg.name} console`, connId: cfg.id, kind: cfg.kind as Tab['kind'], sql: cfg.kind === 'redis' ? 'PING' : ''})

    const onConnect = async (cfg: conn.Config) => {
        try {
            if (!isLive(cfg.id) && !statuses[cfg.id]) await Connect(cfg.id)
            else consoleFor(cfg)
        } catch (e) { report(e, 'app') }
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
        } catch (e) { report(e, 'app') }
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

    const nLive = Object.values(statuses).filter(s => s.state !== 'closed').length
    const kb = useMemo(() => effective(prefs.keybindings), [prefs.keybindings])
    const runKey = fmtCombo(kb['query.run'])
    const modalOpen = () => !!(settingsOpen || dialog || saveReq || confirmState || unsaved || quickOpen)

    // ---- files, folders and file-backed tabs ----
    const extKind = (p: string): 'redis' | 'sql' => (/\.redis$/i.test(p) ? 'redis' : 'sql')

    // a new tab inherits the active tab's connection when it fits, else the first live one
    const defaultConn = (kind: 'redis' | 'sql'): {connId: string; kind: Tab['kind']} => {
        const cur = tabsRef.current.find(t => t.id === active)
        if (kind === 'redis') {
            if (cur?.kind === 'redis') return {connId: cur.connId, kind: 'redis'}
            const c = configs.find(x => x.kind === 'redis' && isLive(x.id)) ?? configs.find(x => x.kind === 'redis')
            return {connId: c?.id ?? '', kind: 'redis'}
        }
        if (cur && cur.kind !== 'redis') return {connId: cur.connId, kind: cur.kind}
        const c = configs.find(x => x.kind === 'postgres' && isLive(x.id)) ?? configs.find(x => x.kind === 'postgres')
        return {connId: c?.id ?? '', kind: 'postgres'}
    }

    const newQuery = () => openTab({title: `Query ${++untitled.current}`, sql: '', pick: true, ...defaultConn('sql')})

    const openFile = async (path: string) => {
        const existing = tabsRef.current.find(t => t.filePath === path)
        if (existing) { setActive(existing.id); consoles.current[existing.id]?.focus(); return }
        try {
            const text = await ReadFile(path)
            openTab({title: baseName(path), filePath: path, savedSql: text, sql: text, pick: true, ...defaultConn(extKind(path))})
        } catch (e) { report(e, 'files') }
    }

    const adoptRoot = (dir: string) => { setRoot(dir); reloadPrefs() }
    const pickFolder = async () => { try { const d = await PickFolder(); if (d) adoptRoot(d) } catch (e) { report(e, 'files') } }
    const openRecent = async (dir: string) => { try { adoptRoot(await OpenFolder(dir)) } catch (e) { report(e, 'files'); reloadPrefs() } }
    const closeFolder = async () => { await CloseFolder(); setRoot(''); reloadPrefs() }
    const pickFile = async () => { try { const p = await PickOpenFile(); if (p) openFile(p) } catch (e) { report(e, 'files') } }

    const saveTab = async (id: string, saveAs = false): Promise<boolean> => {
        const t = tabsRef.current.find(x => x.id === id)
        if (!t) return false
        try {
            let path = t.filePath
            if (!path || saveAs) {
                const ext = t.kind === 'redis' ? '.redis' : '.sql'
                path = await PickSaveFile(t.filePath ? baseName(t.filePath) : t.title.replace(/[^\w.-]+/g, '_') + ext)
                if (!path) return false
            }
            await WriteFile(path, t.sql)
            patchTab(id, {filePath: path, savedSql: t.sql, title: baseName(path), pick: true})
            return true
        } catch (e) { report(e, 'files'); return false }
    }

    const requestClose = (id: string) => {
        const t = tabsRef.current.find(x => x.id === id)
        if (t && isDirty(t)) setUnsaved(t)
        else closeTab(id)
    }

    // a file/folder was renamed or moved (newPath) or trashed (null): keep tabs pointing at the right file
    const onPathChanged = (oldPath: string, newPath: string | null) => {
        setTabs(ts => ts.map(t => {
            const fp = t.filePath
            if (!fp || !(fp === oldPath || fp.startsWith(oldPath + '/') || fp.startsWith(oldPath + '\\'))) return t
            if (newPath === null) return {...t, filePath: undefined, savedSql: undefined} // content stays, as an unsaved query
            const np = newPath + fp.slice(oldPath.length)
            return {...t, filePath: np, title: fp === oldPath ? baseName(np) : t.title}
        }))
    }

    const cycleTab = (d: number) => {
        const ts = tabsRef.current
        if (ts.length < 2) return false
        const i = ts.findIndex(t => t.id === active)
        setActive(ts[(i + d + ts.length) % ts.length].id)
    }

    // ---- global shortcuts (remappable in Settings > Keyboard) ----
    const guard = (fn: () => boolean | void) => () => (modalOpen() ? false : fn())
    handlers.current = {
        'file.new': guard(newQuery),
        'file.open': guard(() => void pickFile()),
        'file.openFolder': guard(() => void pickFolder()),
        'file.save': guard(() => (activeTab ? void saveTab(activeTab.id) : false)),
        'file.saveAs': guard(() => (activeTab ? void saveTab(activeTab.id, true) : false)),
        'tab.close': guard(() => (activeTab ? requestClose(activeTab.id) : false)),
        'tab.next': guard(() => cycleTab(1)),
        'tab.prev': guard(() => cycleTab(-1)),
        'nav.quickOpen': guard(() => setQuickOpen(true)),
        'view.sidebar': guard(() => setHidden(h => !h)),
        'settings.open': guard(() => setSettingsOpen('appearance')),
        'query.run': guard(() => (activeTab && consoles.current[activeTab.id] ? consoles.current[activeTab.id].run() : false)),
        'query.runAlt': guard(() => (activeTab && consoles.current[activeTab.id] ? consoles.current[activeTab.id].run() : false)),
        'query.cancel': () => {
            const el = document.activeElement as HTMLElement | null
            const typing = el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || (el.tagName === 'TEXTAREA' && !el.classList.contains('inputarea')))
            if (modalOpen() || menu || typing || !activeTab?.running || !activeTab.queryId) return false
            CancelQuery(activeTab.queryId)
        },
    }
    useEffect(() => installShortcuts(() => effective(prefsRef.current.keybindings), () => handlers.current), [])
    const prefsRef = useRef(prefs)
    prefsRef.current = prefs

    // ---- boot: reopen the last folder, then restore the session ----
    useEffect(() => {
        if (booted.current) return
        booted.current = true
        ;(async () => {
            if (prefs.lastFolder) { try { setRoot(await OpenFolder(prefs.lastFolder)) } catch { reloadPrefs() } }
            try {
                const raw = await LoadSession()
                const s = raw ? JSON.parse(raw) : null
                const out: Tab[] = []
                for (const st of s?.tabs ?? []) {
                    const t: Tab = {id: st.id || uid(), title: st.title || 'Query', connId: st.connId ?? '', kind: st.kind ?? 'postgres', sql: st.sql ?? '', pick: !!st.pick}
                    if (st.filePath) {
                        try {
                            const disk = await ReadFile(st.filePath)
                            t.filePath = st.filePath; t.savedSql = disk
                            t.sql = st.sql === st.savedSql ? disk : st.sql // untouched tabs follow the file, edited ones keep their edits
                        } catch { /* file gone or no longer readable: the text lives on as an unsaved query */ }
                    }
                    out.push(t)
                }
                if (out.length) { setTabs(out); setActive(out.some(t => t.id === s.active) ? s.active : out[0].id) }
                if (s?.hidden) setHidden(true)
                for (const t of out) if (/^Query \d+$/.test(t.title)) untitled.current = Math.max(untitled.current, Number(t.title.slice(6)))
            } catch { /* corrupt session file: start clean */ }
            restored.current = true
        })()
    }, [])

    // persist open tabs (text only, not results) shortly after any change
    useEffect(() => {
        if (!restored.current) return
        const h = setTimeout(() => {
            const snap = {v: 1, active, hidden, tabs: tabs.map(({id, title, connId, kind, sql, filePath, savedSql, pick}) => ({id, title, connId, kind, sql, filePath, savedSql, pick}))}
            SaveSession(JSON.stringify(snap)).catch(e => report(e, 'session'))
        }, 500)
        return () => clearTimeout(h)
    }, [tabs, active, hidden])

    // autosave file tabs once typing pauses
    useEffect(() => {
        if (!prefs.autosave) return
        const h = setTimeout(() => { for (const t of tabsRef.current) if (isDirty(t)) saveTab(t.id) }, 1000)
        return () => clearTimeout(h)
    }, [tabs, prefs.autosave])

    // files edited outside the app: follow them, or ask when we hold unsaved edits
    useEffect(() => EventsOn('app:error', (e: {source: string; text: string}) => report(e.text, e.source)), [])

    useEffect(() => EventsOn('fs:changed', async (paths: string[]) => {
        const changed = new Set(paths)
        for (const t of tabsRef.current) {
            if (!t.filePath || !changed.has(t.filePath)) continue
            let disk: string
            try { disk = await ReadFile(t.filePath) } catch { continue }
            if (disk === t.savedSql) continue // our own save
            if (t.sql === t.savedSql) patchTab(t.id, {sql: disk, savedSql: disk})
            else if (t.sql === disk) patchTab(t.id, {savedSql: disk})
            else setConfirmState({
                title: 'File changed on disk', label: 'Reload',
                message: `"${baseName(t.filePath)}" was modified outside data-clutch.\n\nReload it and discard your unsaved edits?`,
                run: async () => patchTab(t.id, {sql: disk, savedSql: disk}),
                cancel: () => patchTab(t.id, {savedSql: disk}), // keep my edits; they now differ from the new file
            })
        }
    }), [])

    useEffect(() => { GetMcpInfo().then(i => setMcp({running: i.running, port: i.port})).catch(e => report(e, 'mcp')) }, [settingsOpen])

    const choicesFor = (t: Tab): ConnChoice[] => {
        const label = (c: conn.Config) => c.name + (isLive(c.id) ? '' : ' (not connected)')
        if (t.kind === 'redis') return configs.filter(c => c.kind === 'redis').map(c => ({value: c.id, label: label(c)}))
        return [...configs.filter(c => c.kind === 'postgres').map(c => ({value: c.id, label: label(c)})), {value: 'duck', label: 'Local DuckDB'}]
    }
    const pickConn = (t: Tab, value: string) => {
        if (value === 'duck') patchTab(t.id, {connId: 'duck', kind: 'duck'})
        else if (value === '') patchTab(t.id, {connId: '', kind: t.kind === 'duck' ? 'postgres' : t.kind})
        else patchTab(t.id, {connId: value, kind: (cfgOf(value)?.kind ?? t.kind) as Tab['kind']})
    }

    const editorDo = (action: string) => {
        const ed = getActiveEditor()
        if (!ed) return
        ed.focus()
        ed.trigger('menu', action, null)
    }

    const keyLabel = (id: string) => fmtCombo(kb[id])
    const menus: MenuDef[] = [
        {label: 'File', items: [
            {label: 'New query tab', hint: keyLabel('file.new'), run: newQuery},
            {label: 'Open file…', hint: keyLabel('file.open'), run: pickFile},
            {label: 'Open folder…', hint: keyLabel('file.openFolder'), run: pickFolder},
            ...(prefs.recentFolders?.length ? [{header: 'Recent folders'}, ...prefs.recentFolders.slice(0, 5).map(r => ({label: baseName(r), hint: undefined, run: () => openRecent(r)}))] : []),
            ...(root ? [{label: 'Close folder', run: closeFolder}] : []),
            '-',
            {label: 'Save', hint: keyLabel('file.save'), disabled: !activeTab, run: () => activeTab && saveTab(activeTab.id)},
            {label: 'Save as…', hint: keyLabel('file.saveAs'), disabled: !activeTab, run: () => activeTab && saveTab(activeTab.id, true)},
            {label: 'Close tab', hint: keyLabel('tab.close'), disabled: !activeTab, run: () => activeTab && requestClose(activeTab.id)},
            '-',
            {label: 'Settings…', hint: keyLabel('settings.open'), run: () => setSettingsOpen('appearance')},
        ]},
        {label: 'Edit', items: [
            {label: 'Undo', hint: 'Ctrl+Z', disabled: !activeTab, run: () => editorDo('undo')},
            {label: 'Redo', hint: 'Ctrl+Y', disabled: !activeTab, run: () => editorDo('redo')},
            '-',
            {label: 'Find', hint: 'Ctrl+F', disabled: !activeTab, run: () => editorDo('actions.find')},
            {label: 'Replace', hint: 'Ctrl+H', disabled: !activeTab, run: () => editorDo('editor.action.startFindReplace')},
            {label: 'Select all', hint: 'Ctrl+A', disabled: !activeTab, run: () => editorDo('editor.action.selectAll')},
        ]},
        {label: 'View', items: [
            {label: hidden ? 'Show sidebar' : 'Hide sidebar', hint: keyLabel('view.sidebar'), run: () => setHidden(h => !h)},
            {label: outputOpen ? 'Hide output' : 'Show output', run: () => setOutputOpen(o => !o)},
            {label: 'Go to file…', hint: keyLabel('nav.quickOpen'), run: () => setQuickOpen(true)},
            '-',
            {header: 'Theme'},
            {label: 'Dark', checked: prefs.theme === 'dark', run: () => update({theme: 'dark'})},
            {label: 'Light', checked: prefs.theme === 'light', run: () => update({theme: 'light'})},
            {label: 'Follow system', checked: prefs.theme === 'system', run: () => update({theme: 'system'})},
        ]},
    ]

    const startResize = (e: React.MouseEvent) => {
        e.preventDefault()
        const x0 = e.clientX, w0 = prefs.sidebarWidth
        let w = w0
        const move = (ev: MouseEvent) => { w = Math.max(180, Math.min(700, w0 + ev.clientX - x0)); setDragW(w) }
        const up = () => {
            window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
            document.body.classList.remove('resizing-col')
            update({sidebarWidth: w}); setDragW(null)
        }
        document.body.classList.add('resizing-col')
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
    }
    const sbWidth = dragW ?? prefs.sidebarWidth
    const duckSch = useMemo(() => duckSchema(duck), [duck])

    const runConfirm = async () => {
        const c = confirmState
        setConfirmState(null)
        try { await c?.run() } catch (e) { report(e, 'app') }
    }

    const nameOf = (t: Tab) => (t.kind === 'duck' ? 'Local DuckDB' : t.connId === '' ? 'No connection' : cfgOf(t.connId)?.name ?? 'deleted connection')

    return (
        <div className="app" onClick={() => setMenu(null)}>
            <MenuBar menus={menus}/>
            <div className="main" style={{gridTemplateColumns: hidden ? '1fr' : `${sbWidth}px 1fr`}}>
                <div className="sidebar" style={hidden ? {display: 'none'} : undefined}>
                    <div className="sidebar-head">
                        <span className="title">Database</span><span className="spacer"/>
                        <button className="icon-btn" title="New connection" aria-label="New connection" onClick={() => setDialog(emptyConfig())}><Icon name="plus" color="currentColor"/></button>
                        <button className="icon-btn" title="DuckDB console" aria-label="DuckDB console" onClick={duckConsole}><Icon name="duckdb"/></button>
                        <button className="icon-btn" title="Settings (Ctrl+,)" aria-label="Settings" onClick={() => setSettingsOpen("appearance")}><Icon name="gear" color="currentColor"/></button>
                    </div>
                    <FileTree root={root} onOpenFile={openFile} onOpenFolder={pickFolder} onCloseFolder={closeFolder}
                              onPathChanged={onPathChanged} onError={m => report(m, 'files')}
                              confirm={c => setConfirmState({...c})}/>
                    <Tree configs={configs} statuses={statuses} schemas={schemas} redis={redis} duck={duck}
                          onConnect={onConnect}
                          onMenu={(cfg, x, y) => setMenu({cfg, x, y})}
                          onOpenTable={(cfg, s, t) => openTab({title: t, connId: cfg.id, kind: 'postgres', sql: `select * from ${q(s)}.${q(t)} limit 200;`, autoRun: true})}
                          onOpenKey={(cfg, k) => openTab({title: k.key, connId: cfg.id, kind: 'redis', sql: redisCommand(k), autoRun: true})}
                          onMoreKeys={cfg => loadKeys(cfg.id, true)}
                          onDuckTable={duckOpen}
                          onDuckMenu={(t, x, y) => setMenu({duck: t, x, y})}/>
                </div>
                {!hidden && <div className="sb-resizer" role="separator" aria-orientation="vertical" title="Drag to resize" style={{left: sbWidth - 3}} onMouseDown={startResize}/>}
                <div className="workspace">
                    <div className="tabs" role="tablist">
                        {tabs.map(t => (
                            <div key={t.id} className={`tab ${t.id === active ? 'active' : ''}`} role="tab" aria-selected={t.id === active} tabIndex={0} title={t.filePath ?? t.title}
                                 onClick={() => setActive(t.id)}
                                 onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setActive(t.id) } }}
                                 onAuxClick={e => e.button === 1 && requestClose(t.id)}>
                                {t.running ? <span className="tdot" title="Running"/> : <Icon name={t.filePath !== undefined ? 'file' : kindIcon(t.kind)} size={14}/>}
                                <span className="tab-title">{t.title}</span>{isDirty(t) && <span className="dirty" title="Unsaved changes" aria-label="unsaved"/>}
                                <button className="x" title="Close" aria-label={`Close ${t.title}`} onClick={e => { e.stopPropagation(); requestClose(t.id) }}><Icon name="close" size={12}/></button>
                            </div>
                        ))}
                    </div>
                    {tabs.length === 0 && (
                        <Welcome recent={prefs.recentFolders ?? []} keys={{run: kb['query.run'], open: kb['file.open'], folder: kb['file.openFolder'], neu: kb['file.new']}}
                                 onOpenFolder={pickFolder} onOpenRecent={openRecent} onOpenFile={pickFile} onNew={newQuery}/>
                    )}
                    {/* every tab stays mounted so editor state and results survive switching */}
                    {tabs.map(t => (
                        <div key={t.id} style={{display: t.id === active ? 'flex' : 'none', flex: 1, minHeight: 0, flexDirection: 'column'}}>
                            <Console ref={el => { if (el) consoles.current[t.id] = el; else delete consoles.current[t.id] }}
                                     tab={t} connName={nameOf(t)} live={isLive(t.connId)} runKey={runKey}
                                     choices={t.pick || t.filePath !== undefined ? choicesFor(t) : undefined}
                                     onPickConn={v => pickConn(t, v)} onToast={flash} onError={m => report(m, 'query')}
                                     schema={t.kind === 'duck' ? duckSch : schemas[t.connId]}
                                     onChange={p => patchTab(t.id, p)}
                                     onRun={sql => requestRun(t, sql)}
                                     onCancel={() => t.queryId && CancelQuery(t.queryId)}
                                     onSave={sql => setSaveReq({tab: t, sql})}/>
                        </div>
                    ))}
                </div>
            </div>
            {outputOpen && <OutputPanel onClose={() => setOutputOpen(false)}/>}
            <StatusBar nLive={nLive} nTables={duck.length} root={root} tab={activeTab} connName={activeTab ? nameOf(activeTab) : ''}
                       live={activeTab ? isLive(activeTab.connId) : false} result={activeTab?.result} mcp={mcp}
                       onToggleOutput={() => setOutputOpen(o => !o)} onOpenSettings={() => setSettingsOpen('mcp')}/>

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
            {settingsOpen && <SettingsDialog initial={settingsOpen} onClose={() => setSettingsOpen(null)}/>}
            {saveReq && (
                <SaveDialog connId={saveReq.tab.connId} connName={nameOf(saveReq.tab)} sql={saveReq.sql}
                            onClose={() => setSaveReq(null)}
                            onSaved={(table, rows) => { setSaveReq(null); reloadDuck(); flash(`Saved ${rows} row${rows === 1 ? '' : 's'} to DuckDB table "${table}"`) }}/>
            )}
            {confirmState && (
                <ConfirmDialog title={confirmState.title} message={confirmState.message} confirmLabel={confirmState.label} danger
                               onCancel={() => { confirmState.cancel?.(); setConfirmState(null) }} onConfirm={runConfirm}/>
            )}
            {unsaved && (
                <UnsavedDialog name={unsaved.title}
                               onCancel={() => setUnsaved(null)}
                               onDiscard={() => { closeTab(unsaved.id); setUnsaved(null) }}
                               onSave={async () => { const t = unsaved; setUnsaved(null); if (await saveTab(t.id)) closeTab(t.id) }}/>
            )}
            {quickOpen && <QuickOpen root={root} onOpen={openFile} onClose={() => setQuickOpen(false)}/>}
            {toast && <div className="toast" role="status"><Icon name="check" color="currentColor"/>{toast}</div>}
        </div>
    )
}
