import {ReactNode, useCallback, useEffect, useRef, useState} from 'react'
import {EventsOn} from '../wailsjs/runtime/runtime'
import {
    CreateEntry, DuplicateEntry, ListDir, MoveEntry, RenameEntry, RevealInFileManager, TrashEntry,
} from '../wailsjs/go/main/App'
import {ContextMenu, MenuItem} from './ContextMenu'
import {Icon, IconName} from './Icons'

export interface Entry { name: string; path: string; isDir: boolean }

export const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p
const dirName = (p: string) => p.replace(/[\\/][^\\/]*$/, '') || p
const joinPath = (d: string, n: string) => d + (d.includes('\\') && !d.includes('/') ? '\\' : '/') + n

interface Props {
    root: string
    onOpenFile: (path: string) => void
    onOpenFolder: () => void
    onCloseFolder: () => void
    // a file or folder moved/renamed (newPath set) or went to the trash (null)
    onPathChanged: (oldPath: string, newPath: string | null) => void
    confirm: (c: {title: string; message: string; label: string; run: () => Promise<void>}) => void
    onError: (msg: string) => void
}

type Edit = {mode: 'rename'; path: string} | {mode: 'newFile' | 'newDir'; parent: string; ext: string}
type Menu = {x: number; y: number; entry?: Entry} // entry undefined = the root folder

// Name input row. Settles exactly once: Enter/blur commits, Escape cancels.
function InlineEdit({depth, initial, icon, onDone}: {depth: number; initial: string; icon: IconName; onDone: (v: string | null) => void}) {
    const done = useRef(false)
    const finish = (v: string | null) => { if (!done.current) { done.current = true; onDone(v) } }
    return (
        <div className="row editing">
            {Array.from({length: depth}, (_, i) => <span key={i} className="guide"/>)}
            <span className="twisty"/>
            <span className="ico"><Icon name={icon}/></span>
            <input autoFocus className="inline-edit" defaultValue={initial} spellCheck={false}
                   ref={el => { if (el && !el.dataset.sel) { el.dataset.sel = '1'; const dot = initial.lastIndexOf('.'); el.setSelectionRange(0, dot > 0 ? dot : initial.length) } }}
                   onBlur={e => finish(e.target.value)}
                   onKeyDown={ev => {
                       ev.stopPropagation()
                       if (ev.key === 'Enter') finish(ev.currentTarget.value)
                       if (ev.key === 'Escape') finish(null)
                   }}/>
        </div>
    )
}

const err = (e: unknown) => String(e).replace(/^Error: /, '')

export function FileTree({root, onOpenFile, onOpenFolder, onCloseFolder, onPathChanged, confirm, onError}: Props) {
    const [kids, setKids] = useState<Record<string, Entry[]>>({})
    const [open, setOpen] = useState<Record<string, boolean>>({})
    const [sel, setSel] = useState('')
    const [edit, setEdit] = useState<Edit | null>(null)
    const [menu, setMenu] = useState<Menu | null>(null)
    const [over, setOver] = useState('')
    const [expanded, setExpanded] = useState(true)
    const openRef = useRef(open)
    openRef.current = open
    const dragging = useRef('')

    const load = useCallback(async (dir: string) => {
        try {
            const es = ((await ListDir(dir)) ?? []) as Entry[]
            setKids(k => ({...k, [dir]: es}))
        } catch {
            // the folder vanished: forget it so the tree does not keep a stale listing
            setKids(k => { const n = {...k}; delete n[dir]; return n })
        }
    }, [])
    const refresh = useCallback(() => {
        if (!root) return
        load(root)
        for (const [d, on] of Object.entries(openRef.current)) if (on) load(d)
    }, [root, load])

    useEffect(() => { setKids({}); setOpen({}); setSel(''); setEdit(null); if (root) load(root) }, [root, load])
    useEffect(() => EventsOn('fs:changed', () => refresh()), [refresh])
    useEffect(() => {
        if (!menu) return
        const close = () => setMenu(null)
        window.addEventListener('click', close)
        return () => window.removeEventListener('click', close)
    }, [menu])

    const toggle = (e: Entry) => {
        const on = !open[e.path]
        setOpen(o => ({...o, [e.path]: on}))
        if (on) load(e.path)
    }

    const startNew = (parent: string, mode: 'newFile' | 'newDir', ext = '.sql') => {
        setMenu(null)
        setExpanded(true)
        if (parent !== root) { setOpen(o => ({...o, [parent]: true})); load(parent) }
        setEdit({mode, parent, ext})
    }

    const commit = async (value: string) => {
        const cur = edit
        setEdit(null)
        const name = value.trim()
        if (!cur || !name) return
        try {
            if (cur.mode === 'rename') {
                if (name === baseName(cur.path)) return
                const np = await RenameEntry(cur.path, name)
                onPathChanged(cur.path, np)
            } else if (cur.mode === 'newDir') {
                await CreateEntry(cur.parent, name, true)
            } else {
                const file = /\.(sql|redis)$/i.test(name) ? name : name + cur.ext
                const p = await CreateEntry(cur.parent, file, false)
                refresh()
                onOpenFile(p)
            }
            refresh()
        } catch (e) { onError(err(e)) }
    }

    const trash = (e: Entry) => confirm({
        title: 'Move to trash', message: `Move "${e.name}" to the trash?${e.isDir ? '\nEverything inside the folder goes with it.' : ''}`, label: 'Move to trash',
        run: async () => { await TrashEntry(e.path); onPathChanged(e.path, null); refresh() },
    })

    const act = async (fn: () => Promise<unknown>) => {
        setMenu(null)
        try { await fn(); refresh() } catch (e) { onError(err(e)) }
    }

    const dropOn = async (destDir: string) => {
        const src = dragging.current
        dragging.current = ''
        setOver('')
        if (!src || dirName(src) === destDir) return
        try {
            const np = await MoveEntry(src, destDir)
            onPathChanged(src, np)
            setOpen(o => ({...o, [destDir]: true}))
            refresh()
        } catch (e) { onError(err(e)) }
    }

    const inputRow = (depth: number, initial: string, icon: IconName, key: string) => (
        <InlineEdit key={key} depth={depth} initial={initial} icon={icon} onDone={v => (v === null ? setEdit(null) : commit(v))}/>
    )

    const renderDir = (dir: string, depth: number): ReactNode[] => {
        const out: ReactNode[] = []
        if (edit && edit.mode !== 'rename' && edit.parent === dir) {
            out.push(inputRow(depth, edit.mode === 'newDir' ? 'new-folder' : 'new' + edit.ext, edit.mode === 'newDir' ? 'folder' : 'file', 'new:' + dir))
        }
        for (const e of kids[dir] ?? []) {
            if (edit?.mode === 'rename' && edit.path === e.path) {
                out.push(inputRow(depth, e.name, e.isDir ? 'folder' : 'file', e.path))
            } else {
                const isOpen = !!open[e.path]
                const onKey = (ev: React.KeyboardEvent<HTMLDivElement>) => {
                    const el = ev.currentTarget
                    if (ev.key === 'ArrowDown') { ev.preventDefault(); (el.nextElementSibling as HTMLElement | null)?.focus() }
                    else if (ev.key === 'ArrowUp') { ev.preventDefault(); (el.previousElementSibling as HTMLElement | null)?.focus() }
                    else if (ev.key === 'ArrowRight' && e.isDir && !isOpen) { ev.preventDefault(); toggle(e) }
                    else if (ev.key === 'ArrowLeft' && e.isDir && isOpen) { ev.preventDefault(); toggle(e) }
                    else if (ev.key === 'Enter') { ev.preventDefault(); e.isDir ? toggle(e) : onOpenFile(e.path) }
                    else if (ev.key === 'F2') { ev.preventDefault(); setEdit({mode: 'rename', path: e.path}) }
                    else if (ev.key === 'Delete') { ev.preventDefault(); trash(e) }
                }
                out.push(
                    <div key={e.path} className={`row${sel === e.path ? ' sel' : ''}${over === e.path ? ' drop' : ''}`} role="treeitem" aria-expanded={e.isDir ? isOpen : undefined}
                         tabIndex={0} title={e.path} draggable
                         onFocus={() => setSel(e.path)} onKeyDown={onKey}
                         onClick={() => { setSel(e.path); if (e.isDir) toggle(e) }}
                         onDoubleClick={() => !e.isDir && onOpenFile(e.path)}
                         onContextMenu={ev => { ev.preventDefault(); ev.stopPropagation(); setSel(e.path); setMenu({x: ev.clientX, y: ev.clientY, entry: e}) }}
                         onDragStart={ev => { dragging.current = e.path; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', e.name) }}
                         onDragEnd={() => { dragging.current = ''; setOver('') }}
                         onDragOver={ev => { if (dragging.current && (e.isDir || dirName(e.path) !== dirName(dragging.current))) { ev.preventDefault(); setOver(e.isDir ? e.path : dirName(e.path)) } }}
                         onDrop={ev => { ev.preventDefault(); ev.stopPropagation(); dropOn(e.isDir ? e.path : dirName(e.path)) }}>
                        {Array.from({length: depth}, (_, i) => <span key={i} className="guide"/>)}
                        <span className={`twisty${isOpen ? ' open' : ''}`}>{e.isDir && <Icon name="chevron" size={12}/>}</span>
                        <span className="ico"><Icon name={e.isDir ? (isOpen ? 'folderOpen' : 'folder') : e.name.toLowerCase().endsWith('.redis') ? 'redis' : 'file'}/></span>
                        <span className="label">{e.name}</span>
                    </div>
                )
            }
            if (e.isDir && open[e.path]) out.push(...renderDir(e.path, depth + 1))
        }
        return out
    }

    const entry = menu?.entry
    const target = entry ? (entry.isDir ? entry.path : dirName(entry.path)) : root

    if (!root) {
        return (
            <div className="files-section">
                <div className="section-head" role="button" tabIndex={0} onClick={onOpenFolder}
                     onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onOpenFolder()}>
                    <span className="twisty"/><Icon name="folder"/><span className="label">Files</span>
                    <span className="spacer"/><span className="hint">Open folder…</span>
                </div>
            </div>
        )
    }

    return (
        <div className="files-section" style={expanded ? undefined : {maxHeight: 'none'}}>
            <div className={`section-head${expanded ? ' open' : ''}${over === root ? ' drop' : ''}`} role="button" tabIndex={0} aria-expanded={expanded} title={root}
                 onClick={() => setExpanded(x => !x)}
                 onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(x => !x) } }}
                 onContextMenu={e => { e.preventDefault(); setMenu({x: e.clientX, y: e.clientY}) }}
                 onDragOver={e => { if (dragging.current) { e.preventDefault(); setOver(root) } }}
                 onDrop={e => { e.preventDefault(); dropOn(root) }}>
                <span className={`twisty${expanded ? ' open' : ''}`}><Icon name="chevron" size={12}/></span>
                <Icon name="folderOpen"/>
                <span className="label">{baseName(root)}</span>
                <span className="spacer"/>
                <button className="icon-btn sm" title="New SQL file" aria-label="New SQL file" onClick={e => { e.stopPropagation(); startNew(root, 'newFile') }}><Icon name="newFile" size={14} color="currentColor"/></button>
                <button className="icon-btn sm" title="New folder" aria-label="New folder" onClick={e => { e.stopPropagation(); startNew(root, 'newDir') }}><Icon name="newFolder" size={14} color="currentColor"/></button>
                <button className="icon-btn sm" title="Refresh" aria-label="Refresh files" onClick={e => { e.stopPropagation(); refresh() }}><Icon name="refresh" size={14} color="currentColor"/></button>
                <button className="icon-btn sm" title="Close folder" aria-label="Close folder" onClick={e => { e.stopPropagation(); onCloseFolder() }}><Icon name="close" size={12} color="currentColor"/></button>
            </div>
            {expanded && (
                <div className="tree files" role="tree" onContextMenu={e => { e.preventDefault(); setMenu({x: e.clientX, y: e.clientY}) }}
                     onDragOver={e => { if (dragging.current) e.preventDefault() }} onDrop={e => { e.preventDefault(); dropOn(root) }}>
                    {renderDir(root, 0)}
                    {(kids[root]?.length ?? 0) === 0 && !edit && <div className="row dim"><span className="label">No .sql or .redis files yet</span></div>}
                </div>
            )}
            {menu && (
                <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
                    {entry && !entry.isDir && <MenuItem icon="play" hint="Enter" onClick={() => { setMenu(null); onOpenFile(entry.path) }}>Open</MenuItem>}
                    {(!entry || entry.isDir) && <MenuItem icon="newFile" onClick={() => startNew(target, 'newFile')}>New SQL file</MenuItem>}
                    {(!entry || entry.isDir) && <MenuItem icon="redis" onClick={() => startNew(target, 'newFile', '.redis')}>New Redis file</MenuItem>}
                    {(!entry || entry.isDir) && <MenuItem icon="newFolder" onClick={() => startNew(target, 'newDir')}>New folder</MenuItem>}
                    {entry && <hr/>}
                    {entry && <MenuItem icon="edit" hint="F2" onClick={() => { setMenu(null); setEdit({mode: 'rename', path: entry.path}) }}>Rename</MenuItem>}
                    {entry && <MenuItem icon="copy" onClick={() => act(() => DuplicateEntry(entry.path))}>Duplicate</MenuItem>}
                    <MenuItem icon="folderOpen" onClick={() => act(() => RevealInFileManager(entry ? entry.path : root))}>Show in file manager</MenuItem>
                    {entry && <hr/>}
                    {entry && <MenuItem icon="trash" danger hint="Del" onClick={() => { setMenu(null); trash(entry) }}>Move to trash</MenuItem>}
                </ContextMenu>
            )}
        </div>
    )
}
