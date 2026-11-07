import {useEffect, useMemo, useRef, useState} from 'react'
import {WorkspaceFiles} from '../wailsjs/go/main/App'
import {Dialog} from './Dialog'
import {Icon} from './Icons'

interface F { name: string; path: string }

// subsequence match, scored so contiguous and early hits rank first
function score(q: string, s: string): number {
    if (!q) return 1
    let i = 0, sc = 0, last = -2
    const t = s.toLowerCase()
    for (let j = 0; j < t.length && i < q.length; j++) {
        if (t[j] === q[i]) { sc += j === last + 1 ? 3 : 1; if (j === 0 || '/\\._- '.includes(t[j - 1])) sc += 2; last = j; i++ }
    }
    return i === q.length ? sc - s.length * 0.01 : 0
}

export function QuickOpen({root, onOpen, onClose}: {root: string; onOpen: (path: string) => void; onClose: () => void}) {
    const [files, setFiles] = useState<F[]>([])
    const [q, setQ] = useState('')
    const [idx, setIdx] = useState(0)
    const list = useRef<HTMLDivElement>(null)

    useEffect(() => { if (root) WorkspaceFiles().then(f => setFiles((f ?? []) as F[])).catch(() => {}) }, [root])
    const rel = (p: string) => (p.startsWith(root) ? p.slice(root.length).replace(/^[\\/]/, '') : p)
    const shown = useMemo(() => {
        const needle = q.trim().toLowerCase()
        return files.map(f => ({f, r: rel(f.path)})).map(x => ({...x, s: score(needle, x.r)})).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 60)
    }, [files, q, root])

    useEffect(() => setIdx(0), [q])
    useEffect(() => { (list.current?.children[idx] as HTMLElement | undefined)?.scrollIntoView({block: 'nearest'}) }, [idx])

    const key = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, shown.length - 1)) }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)) }
        else if (e.key === 'Enter' && shown[idx]) { e.preventDefault(); onOpen(shown[idx].f.path); onClose() }
    }

    return (
        <Dialog title="Go to file" icon="file" width={560} onClose={onClose}>
            <div className="quickopen">
                <input autoFocus type="text" placeholder={root ? 'Type to filter .sql and .redis files' : 'Open a folder first'} disabled={!root}
                       value={q} onChange={e => setQ(e.target.value)} onKeyDown={key}/>
                <div className="qo-list" ref={list} role="listbox">
                    {shown.map((x, i) => (
                        <div key={x.f.path} role="option" aria-selected={i === idx} className={`qo-item${i === idx ? ' on' : ''}`}
                             onMouseEnter={() => setIdx(i)} onClick={() => { onOpen(x.f.path); onClose() }}>
                            <Icon name={x.f.name.toLowerCase().endsWith('.redis') ? 'redis' : 'file'} size={14}/>
                            <span className="qo-name">{x.f.name}</span><span className="qo-dir">{x.r.slice(0, x.r.length - x.f.name.length).replace(/[\\/]$/, '')}</span>
                        </div>
                    ))}
                    {root && shown.length === 0 && <div className="qo-empty">No matching files</div>}
                </div>
            </div>
        </Dialog>
    )
}
