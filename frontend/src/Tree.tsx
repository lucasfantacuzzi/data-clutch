import {ReactNode, useRef, useState} from 'react'
import {conn} from '../wailsjs/go/models'
import {Icon, IconName, redisTypeIcon} from './Icons'
import {DuckTable, RedisKey, RedisPage, Schema, Status} from './types'

interface Props {
    configs: conn.Config[]
    statuses: Record<string, Status>
    schemas: Record<string, Schema | undefined>
    redis: Record<string, RedisPage | undefined>
    duck: DuckTable[]
    onConnect: (c: conn.Config) => void
    onMenu: (c: conn.Config, x: number, y: number) => void
    onOpenTable: (c: conn.Config, schema: string, table: string) => void
    onOpenKey: (c: conn.Config, k: RedisKey) => void
    onMoreKeys: (c: conn.Config) => void
    onDuckTable: (t: DuckTable) => void
    onDuckMenu: (t: DuckTable, x: number, y: number) => void
}

const DUCK_H_KEY = 'clutch.duckHeight'
const loadDuckH = () => {
    try { return Math.max(80, Number(localStorage.getItem(DUCK_H_KEY)) || 200) } catch { return 200 }
}

function statusText(s?: Status) {
    if (!s) return ''
    if (s.state === 'reconnecting') {
        const left = s.nextRetryMs ? Math.max(0, Math.round((s.nextRetryMs - Date.now()) / 1000)) : 0
        return `reconnecting${s.nextRetryMs ? ` in ${left}s` : '…'}`
    }
    if (s.state === 'ready' || s.state === 'busy') return ''
    return s.state
}

interface KNode { folders: Map<string, KNode>; keys: RedisKey[] }
function buildKeyTree(keys: RedisKey[]): KNode {
    const root: KNode = {folders: new Map(), keys: []}
    for (const k of keys) {
        const parts = k.key.split(':')
        let n = root
        for (const p of parts.slice(0, -1)) {
            if (!n.folders.has(p)) n.folders.set(p, {folders: new Map(), keys: []})
            n = n.folders.get(p)!
        }
        n.keys.push(k)
    }
    return root
}
const countKeys = (n: KNode): number => n.keys.length + [...n.folders.values()].reduce((a, f) => a + countKeys(f), 0)

interface RowOpts {
    k: string; depth: number; label: string; icon?: IconName; meta?: string; badge?: string | number; tone?: 'warn' | 'err'
    expandable?: boolean; dot?: string; title?: string; folder?: boolean; dim?: boolean
    onDouble?: () => void; onContext?: (e: React.MouseEvent) => void; onClick?: () => void
}

export function Tree(p: Props) {
    const [open, setOpen] = useState<Record<string, boolean>>({})
    const [sel, setSel] = useState('')
    const [duckH, setDuckH] = useState(loadDuckH)
    const box = useRef<HTMLDivElement>(null)
    const toggle = (k: string) => setOpen(o => ({...o, [k]: !o[k]}))
    let tabStop = false

    const row = (o: RowOpts) => {
        const isOpen = !!open[o.k]
        const tabbable = sel ? sel === o.k : !tabStop
        tabStop = tabStop || tabbable
        const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
            const el = e.currentTarget
            if (e.key === 'ArrowDown') { e.preventDefault(); (el.nextElementSibling as HTMLElement | null)?.focus() }
            else if (e.key === 'ArrowUp') { e.preventDefault(); (el.previousElementSibling as HTMLElement | null)?.focus() }
            else if (e.key === 'ArrowRight' && o.expandable && !isOpen) { e.preventDefault(); toggle(o.k) }
            else if (e.key === 'ArrowLeft' && o.expandable && isOpen) { e.preventDefault(); toggle(o.k) }
            else if (e.key === 'Enter') { e.preventDefault(); if (o.onDouble) o.onDouble(); else if (o.expandable) toggle(o.k) }
            else if (e.key === ' ' && o.expandable) { e.preventDefault(); toggle(o.k) }
        }
        const icon: IconName | undefined = o.folder ? (isOpen ? 'folderOpen' : 'folder') : o.icon
        return (
            <div key={o.k} className={`row${sel === o.k ? ' sel' : ''}${o.dim ? ' dim' : ''}`} role="treeitem" aria-expanded={o.expandable ? isOpen : undefined}
                 tabIndex={tabbable ? 0 : -1} title={o.title ?? o.label}
                 onFocus={() => setSel(o.k)} onKeyDown={onKey}
                 onClick={() => { setSel(o.k); if (o.expandable) toggle(o.k); o.onClick?.() }}
                 onDoubleClick={o.onDouble} onContextMenu={o.onContext}>
                {Array.from({length: o.depth}, (_, i) => <span key={i} className="guide"/>)}
                <span className={`twisty${isOpen ? ' open' : ''}`}>{o.expandable && <Icon name="chevron" size={12}/>}</span>
                {(icon || o.dot) && (
                    <span className="ico">
                        {icon && <Icon name={icon}/>}
                        {o.dot && <span className={`dot ${o.dot}`}/>}
                    </span>
                )}
                <span className="label">{o.label}</span>
                {o.badge !== undefined && o.badge !== '' && <span className="badge">{o.badge}</span>}
                {o.meta && <span className={`meta${o.tone ? ' ' + o.tone : ''}`}>{o.meta}</span>}
            </div>
        )
    }

    const renderKeys = (cfg: conn.Config, n: KNode, path: string, depth: number): ReactNode[] => {
        const out: ReactNode[] = []
        for (const [name, f] of [...n.folders].sort((a, b) => a[0].localeCompare(b[0]))) {
            const k = `${path}/${name}:`
            out.push(row({k, depth, label: name, folder: true, expandable: true, badge: countKeys(f)}))
            if (open[k]) out.push(...renderKeys(cfg, f, k, depth + 1))
        }
        for (const key of n.keys) {
            const ttl = key.ttl >= 0 ? `${key.ttl}s` : ''
            out.push(row({k: `${path}#${key.key}`, depth, label: key.key.split(':').slice(-1)[0], title: `${key.key} (${key.type})`, icon: redisTypeIcon(key.type), meta: ttl || key.type,
                          onDouble: () => p.onOpenKey(cfg, key)}))
        }
        return out
    }

    const rows: ReactNode[] = []
    for (const cfg of p.configs) {
        const st = p.statuses[cfg.id]
        const live = !!st && st.state !== 'closed'
        const ck = cfg.id
        const text = statusText(st)
        const addr = `${cfg.host}:${cfg.port}/${cfg.database}`
        rows.push(row({k: ck, depth: 0, label: cfg.name, icon: cfg.kind === 'redis' ? 'redis' : 'postgres', dot: live ? st.state : 'closed', expandable: true,
                       meta: text || (cfg.readOnly ? 'read-only' : 'read-write'), tone: st?.state === 'reconnecting' ? 'warn' : undefined,
                       title: st?.error ? `${addr}\n${st.error}` : addr,
                       onDouble: () => p.onConnect(cfg), onContext: e => { e.preventDefault(); p.onMenu(cfg, e.clientX, e.clientY) }}))
        if (!open[ck]) continue
        if (!live) { rows.push(row({k: ck + ':off', depth: 1, label: 'Double-click to connect', dim: true})); continue }
        if (st.state === 'reconnecting') rows.push(row({k: ck + ':re', depth: 1, label: st.error ? `Waiting for the server: ${st.error}` : 'Connecting…', dim: true, title: st.error}))

        if (cfg.kind === 'redis') {
            const page = p.redis[cfg.id]
            if (!page) { rows.push(row({k: ck + ':load', depth: 1, label: 'Loading keys…', dim: true})); continue }
            rows.push(row({k: ck + ':db', depth: 1, label: `db${cfg.database || 0}`, icon: 'database', badge: `${page.dbSize} keys`, expandable: true}))
            if (open[ck + ':db']) {
                rows.push(...renderKeys(cfg, buildKeyTree(page.keys), ck, 2))
                if (page.cursor !== '0') rows.push(row({k: ck + ':more', depth: 2, label: `Load more… (${page.keys.length}/${page.dbSize})`, icon: 'more', onClick: () => p.onMoreKeys(cfg)}))
            }
            continue
        }

        const sch = p.schemas[cfg.id]
        if (!sch) { if (st.state !== 'reconnecting') rows.push(row({k: ck + ':load', depth: 1, label: 'Loading schema…', dim: true})); continue }
        for (const s of sch.schemas) {
            const sk = `${ck}/${s.name}`
            rows.push(row({k: sk, depth: 1, label: s.name, icon: 'schema', expandable: true, badge: s.tables.length}))
            if (!open[sk]) continue
            for (const t of s.tables) {
                const tk = `${sk}/${t.name}`
                rows.push(row({k: tk, depth: 2, label: t.name, icon: t.kind === 'view' || t.kind === 'matview' ? 'view' : 'table', expandable: true, meta: t.kind === 'table' ? '' : t.kind, title: t.comment || t.name,
                               onDouble: () => p.onOpenTable(cfg, s.name, t.name)}))
                if (!open[tk]) continue
                rows.push(row({k: tk + ':c', depth: 3, label: 'columns', icon: 'column', expandable: true, badge: t.columns.length}))
                if (open[tk + ':c']) for (const c of t.columns) rows.push(row({k: `${tk}:c:${c.name}`, depth: 4, label: c.name, icon: c.pk ? 'pk' : 'column', meta: c.type + (c.notNull ? '' : '?')}))
                rows.push(row({k: tk + ':i', depth: 3, label: 'indexes', icon: 'index', expandable: true, badge: t.indexes.length}))
                if (open[tk + ':i']) for (const i of t.indexes) rows.push(row({k: `${tk}:i:${i.name}`, depth: 4, label: i.name, icon: i.primary ? 'pk' : 'index', meta: i.unique && !i.primary ? 'unique' : '', title: i.def}))
                rows.push(row({k: tk + ':k', depth: 3, label: 'constraints', icon: 'constraint', expandable: true, badge: t.constraints.length}))
                if (open[tk + ':k']) for (const k of t.constraints) rows.push(row({k: `${tk}:k:${k.name}`, depth: 4, label: k.name, icon: 'constraint', meta: k.type, title: k.def}))
            }
        }
    }

    const duckRows: ReactNode[] = []
    if (open['duck']) {
        if (p.duck.length === 0) duckRows.push(row({k: 'duck:none', depth: 0, label: 'No saved results yet', dim: true}))
        for (const t of p.duck) {
            const tk = 'duck/' + t.name
            duckRows.push(row({k: tk, depth: 0, label: t.name, icon: 'table', expandable: true, meta: `${t.rows} rows`,
                               title: t.sourceSql ? `${t.sourceConn}: ${t.sourceSql}` : t.name,
                               onDouble: () => p.onDuckTable(t), onContext: e => { e.preventDefault(); p.onDuckMenu(t, e.clientX, e.clientY) }}))
            if (open[tk]) for (const c of t.columns) duckRows.push(row({k: `${tk}:${c.name}`, depth: 1, label: c.name, icon: 'column', meta: c.type.toLowerCase()}))
        }
    }

    const dragDuck = (e: React.MouseEvent) => {
        e.preventDefault()
        const startY = e.clientY, start = duckH
        const max = () => (box.current?.clientHeight ?? 600) - 120
        let latest = start
        const move = (ev: MouseEvent) => { latest = Math.min(max(), Math.max(80, start - (ev.clientY - startY))); setDuckH(latest) }
        const up = () => {
            window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
            document.body.classList.remove('resizing-row')
            try { localStorage.setItem(DUCK_H_KEY, String(latest)) } catch { /* storage unavailable */ }
        }
        document.body.classList.add('resizing-row')
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
    }

    const duckOpen = !!open['duck']

    return (
        <div className="sidebar-split" ref={box}>
            <div className="tree" role="tree">
                {rows}
                {p.configs.length === 0 && (
                    <div className="tree-empty">
                        <Icon name="database" size={28} color="var(--text-disabled)"/>
                        <div>No connections yet</div>
                        <div className="hint">Use the <Icon name="plus" size={12}/> button above to add one.</div>
                    </div>
                )}
            </div>
            {duckOpen && <div className="splitter-h" role="separator" aria-orientation="horizontal" title="Drag to resize" onMouseDown={dragDuck}/>}
            <div className="duck-section" style={duckOpen ? {height: duckH} : undefined}>
                <div className={`section-head${duckOpen ? ' open' : ''}`} role="button" tabIndex={0} aria-expanded={duckOpen}
                     onClick={() => toggle('duck')}
                     onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle('duck') } }}>
                    <span className={`twisty${duckOpen ? ' open' : ''}`}><Icon name="chevron" size={12}/></span>
                    <Icon name="duckdb"/>
                    <span className="label">Local DuckDB</span>
                    <span className="badge">{p.duck.length}</span>
                </div>
                {duckOpen && <div className="tree duck" role="tree">{duckRows}</div>}
            </div>
        </div>
    )
}
