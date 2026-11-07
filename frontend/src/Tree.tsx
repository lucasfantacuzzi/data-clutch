import {ReactNode, useState} from 'react'
import {conn} from '../wailsjs/go/models'
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

const KIND_ICON: Record<string, string> = {table: '▦', view: '◫', matview: '◫', foreign: '▦', partitioned: '▦'}
const TYPE_ICON: Record<string, string> = {string: 'S', hash: 'H', list: 'L', set: '∪', zset: 'Z', stream: '≋'}

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

export function Tree(p: Props) {
    const [open, setOpen] = useState<Record<string, boolean>>({})
    const [sel, setSel] = useState('')
    const toggle = (k: string) => setOpen(o => ({...o, [k]: !o[k]}))

    const row = (o: {k: string; depth: number; label: string; icon?: string; meta?: string; expandable?: boolean; dot?: string; title?: string;
                     onDouble?: () => void; onContext?: (e: React.MouseEvent) => void; dim?: boolean; onClick?: () => void}) => (
        <div key={o.k} className={`row ${sel === o.k ? 'sel' : ''}`} style={{paddingLeft: 8 + o.depth * 14, color: o.dim ? 'var(--fg-dim)' : undefined}} title={o.title}
             onClick={() => { setSel(o.k); if (o.expandable) toggle(o.k); o.onClick?.() }}
             onDoubleClick={o.onDouble} onContextMenu={o.onContext}>
            <span className="twisty">{o.expandable ? (open[o.k] ? '▼' : '▶') : ''}</span>
            {o.dot ? <span className={`dot ${o.dot}`}/> : <span className="ico">{o.icon}</span>}
            <span style={{overflow: 'hidden', textOverflow: 'ellipsis'}}>{o.label}</span>
            {o.meta && <span className="meta">{o.meta}</span>}
        </div>
    )

    const renderKeys = (cfg: conn.Config, n: KNode, path: string, depth: number): ReactNode[] => {
        const out: ReactNode[] = []
        for (const [name, f] of [...n.folders].sort((a, b) => a[0].localeCompare(b[0]))) {
            const k = `${path}/${name}:`
            out.push(row({k, depth, label: name, icon: '📁', expandable: true, meta: String(countKeys(f))}))
            if (open[k]) out.push(...renderKeys(cfg, f, k, depth + 1))
        }
        for (const key of n.keys) {
            const ttl = key.ttl >= 0 ? `${key.ttl}s` : ''
            out.push(row({k: `${path}#${key.key}`, depth, label: key.key.split(':').slice(-1)[0], title: key.key, icon: TYPE_ICON[key.type] ?? '?', meta: ttl || key.type,
                          onDouble: () => p.onOpenKey(cfg, key)}))
        }
        return out
    }

    const rows: ReactNode[] = []
    for (const cfg of p.configs) {
        const st = p.statuses[cfg.id]
        const live = !!st && st.state !== 'closed'
        const ck = cfg.id
        rows.push(row({k: ck, depth: 0, label: cfg.name, dot: live ? st.state : 'closed', expandable: true,
                       meta: statusText(st) || (cfg.readOnly ? 'read-only' : 'read-write'), title: st?.error,
                       onDouble: () => p.onConnect(cfg), onContext: e => { e.preventDefault(); p.onMenu(cfg, e.clientX, e.clientY) }}))
        if (!open[ck]) continue
        if (!live) { rows.push(row({k: ck + ':off', depth: 1, label: 'Double-click to connect', dim: true})); continue }
        if (st.state === 'reconnecting') rows.push(row({k: ck + ':re', depth: 1, label: st.error ? `Waiting for the server: ${st.error}` : 'Connecting…', dim: true, title: st.error}))

        if (cfg.kind === 'redis') {
            const page = p.redis[cfg.id]
            if (!page) { rows.push(row({k: ck + ':load', depth: 1, label: 'Loading keys…', dim: true})); continue }
            rows.push(row({k: ck + ':db', depth: 1, label: `db${cfg.database || 0}`, icon: '▤', meta: `${page.dbSize} keys`, expandable: true}))
            if (open[ck + ':db']) {
                rows.push(...renderKeys(cfg, buildKeyTree(page.keys), ck, 2))
                if (page.cursor !== '0') rows.push(row({k: ck + ':more', depth: 2, label: `Load more… (${page.keys.length}/${page.dbSize})`, icon: '⋯', onClick: () => p.onMoreKeys(cfg)}))
            }
            continue
        }

        const sch = p.schemas[cfg.id]
        if (!sch) { if (st.state !== 'reconnecting') rows.push(row({k: ck + ':load', depth: 1, label: 'Loading schema…', dim: true})); continue }
        for (const s of sch.schemas) {
            const sk = `${ck}/${s.name}`
            rows.push(row({k: sk, depth: 1, label: s.name, icon: '▤', expandable: true, meta: String(s.tables.length)}))
            if (!open[sk]) continue
            for (const t of s.tables) {
                const tk = `${sk}/${t.name}`
                rows.push(row({k: tk, depth: 2, label: t.name, icon: KIND_ICON[t.kind] ?? '▦', expandable: true, meta: t.kind === 'table' ? '' : t.kind, title: t.comment,
                               onDouble: () => p.onOpenTable(cfg, s.name, t.name)}))
                if (!open[tk]) continue
                rows.push(row({k: tk + ':c', depth: 3, label: 'columns', icon: '≡', expandable: true, meta: String(t.columns.length)}))
                if (open[tk + ':c']) for (const c of t.columns) rows.push(row({k: `${tk}:c:${c.name}`, depth: 4, label: c.name, icon: c.pk ? '🔑' : '·', meta: c.type + (c.notNull ? '' : '?')}))
                rows.push(row({k: tk + ':i', depth: 3, label: 'indexes', icon: '⚡', expandable: true, meta: String(t.indexes.length)}))
                if (open[tk + ':i']) for (const i of t.indexes) rows.push(row({k: `${tk}:i:${i.name}`, depth: 4, label: i.name, icon: i.primary ? '🔑' : i.unique ? 'U' : '·', title: i.def}))
                rows.push(row({k: tk + ':k', depth: 3, label: 'constraints', icon: '⛓', expandable: true, meta: String(t.constraints.length)}))
                if (open[tk + ':k']) for (const k of t.constraints) rows.push(row({k: `${tk}:k:${k.name}`, depth: 4, label: k.name, meta: k.type, title: k.def}))
            }
        }
    }

    const duckRows: ReactNode[] = []
    duckRows.push(row({k: 'duck', depth: 0, label: 'Local DuckDB', icon: '🦆', expandable: true, meta: String(p.duck.length)}))
    if (open['duck']) {
        if (p.duck.length === 0) duckRows.push(row({k: 'duck:none', depth: 1, label: 'No saved results yet', dim: true}))
        for (const t of p.duck) {
            const tk = 'duck/' + t.name
            duckRows.push(row({k: tk, depth: 1, label: t.name, icon: '▦', expandable: true, meta: `${t.rows} rows`,
                               title: t.sourceSql ? `${t.sourceConn}: ${t.sourceSql}` : undefined,
                               onDouble: () => p.onDuckTable(t), onContext: e => { e.preventDefault(); p.onDuckMenu(t, e.clientX, e.clientY) }}))
            if (open[tk]) for (const c of t.columns) duckRows.push(row({k: `${tk}:${c.name}`, depth: 2, label: c.name, icon: '·', meta: c.type.toLowerCase()}))
        }
    }

    return (
        <div className="sidebar-split">
            <div className="tree" style={{flex: 1}}>
                {rows}
                {p.configs.length === 0 && <div className="row" style={{color: 'var(--fg-dim)', paddingLeft: 12}}>No connections. Click ＋ to add one.</div>}
            </div>
            <div className="tree duck">{duckRows}</div>
        </div>
    )
}
