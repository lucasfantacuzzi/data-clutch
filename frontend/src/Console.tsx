import {forwardRef, useEffect, useImperativeHandle, useRef, useState} from 'react'
import Editor, {OnMount} from '@monaco-editor/react'
import './monaco'
import {monaco, setActiveEditor} from './monaco'
import {CancelQuery, ExportFull, ExportLoaded} from '../wailsjs/go/main/App'
import {ContextMenu, MenuItem} from './ContextMenu'
import {dropContext, registerCompletion, setContext, Dialect} from './completion'
import {statementAt} from './sql'
import {ResultGrid} from './ResultGrid'
import {Icon, kindIcon} from './Icons'
import {Pinned, Result, Schema, Tab} from './types'
import {usePrefs} from './prefs'
import {report} from './log'

export interface ConsoleHandle { run: () => void; focus: () => void }
export interface ConnChoice { value: string; label: string }

interface Props {
    tab: Tab
    connName: string
    live: boolean
    runKey: string // formatted shortcut for the hint
    choices?: ConnChoice[] // file-backed tabs pick their connection here
    onPickConn?: (value: string) => void
    onToast: (msg: string) => void
    onError: (msg: string) => void
    schema?: Schema
    onChange: (patch: Partial<Tab>) => void
    onRun: (sql: string) => void
    onCancel: () => void
    onSave: (sql: string) => void
}

const MAX_PINS = 10
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2))

export const Console = forwardRef<ConsoleHandle, Props>(function Console({tab, connName, live, runKey, choices, onPickConn, onToast, onError, schema, onChange, onRun, onCancel, onSave}, ref) {
    const {prefs, resolved, monoFont} = usePrefs()
    const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
    const [split, setSplit] = useState(260)
    const run = useRef<() => void>(() => {})
    const [exportMenu, setExportMenu] = useState<{x: number; y: number} | null>(null)
    const [exporting, setExporting] = useState('') // query id of a running full export
    useImperativeHandle(ref, () => ({run: () => run.current(), focus: () => editor.current?.focus()}))
    const [view, setView] = useState('live') // 'live' or a pinned result id
    const [renaming, setRenaming] = useState('')
    const seq = useRef(0)

    const dialect: Dialect = tab.kind === 'duck' ? 'duck' : tab.kind
    const lang = tab.kind === 'redis' ? 'redis' : 'sql'
    const path = `inmemory://tab/${tab.id}`

    // text to run: selection, else the statement under the cursor (Redis: current line)
    run.current = () => {
        const ed = editor.current
        const model = ed?.getModel()
        if (!ed || !model) return
        const sel = ed.getSelection()
        let sql = sel && !sel.isEmpty() ? model.getValueInRange(sel) : ''
        if (!sql) {
            const pos = ed.getPosition()!
            sql = tab.kind === 'redis' ? model.getLineContent(pos.lineNumber) : statementAt(model.getValue(), model.getOffsetAt(pos))
        }
        if (sql.trim()) onRun(sql.trim())
    }

    // a new run always shows its own result; a closed pin falls back to live
    useEffect(() => { if (tab.running) setView('live') }, [tab.running])
    useEffect(() => { if (view !== 'live' && !(tab.pins ?? []).some(p => p.id === view)) setView('live') }, [tab.pins, view])

    useEffect(() => { setContext(path, {dialect, schema}) }, [path, dialect, schema])
    useEffect(() => () => { dropContext(path) }, [path])

    // tabs opened with a ready-made query (table double-click) run once
    useEffect(() => {
        if (tab.autoRun && live) { onChange({autoRun: false}); onRun(tab.sql) }
    }, [tab.autoRun, live])

    const onMount: OnMount = ed => {
        registerCompletion()
        editor.current = ed
        // Run shortcuts are global and remappable (keybindings.ts); only focus tracking lives here.
        ed.onDidFocusEditorText(() => setActiveEditor(ed))
        ed.focus()
    }

    const drag = (e: React.MouseEvent) => {
        e.preventDefault()
        const startY = e.clientY, start = split
        const move = (ev: MouseEvent) => setSplit(Math.max(80, start + ev.clientY - startY))
        const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
        window.addEventListener('mousemove', move)
        window.addEventListener('mouseup', up)
    }

    const pins = tab.pins ?? []
    const pinned = pins.find(p => p.id === view)
    const r: Result | undefined = pinned ? pinned.result : tab.result
    const shownSql = pinned ? pinned.sql : tab.ranSql
    const err = pinned ? undefined : tab.error
    const running = !pinned && tab.running
    const hasRows = !!r && r.columns.length > 0
    const canSave = hasRows && tab.kind !== 'duck' && !tab.running && !!shownSql
    const canPin = !pinned && hasRows && !running && !!tab.ranSql && pins.length < MAX_PINS

    const pin = () => {
        if (!tab.result || !tab.ranSql) return
        const p: Pinned = {id: uid(), title: `Result ${++seq.current}`, sql: tab.ranSql, result: tab.result, at: Date.now()}
        onChange({pins: [...pins, p]})
    }
    const unpin = (id: string) => onChange({pins: pins.filter(p => p.id !== id)})
    const rename = (id: string, title: string) => {
        onChange({pins: pins.map(p => (p.id === id ? {...p, title: title.trim() || p.title} : p))})
        setRenaming('')
    }
    const exportName = () => (tab.title.replace(/\.(sql|redis)$/i, '').replace(/[^\w.-]+/g, '_') || 'result') + '.csv'
    const exportLoaded = async () => {
        setExportMenu(null)
        if (!r) return
        try {
            const info = await ExportLoaded(r.columns.map(c => c.name), r.rows, exportName())
            if (info?.path) onToast(`Exported ${info.rows} row${info.rows === 1 ? '' : 's'} to ${info.path}`)
        } catch (e) { onError(String(e).replace(/^Error: /, '')) }
    }
    const exportFull = async () => {
        setExportMenu(null)
        if (!shownSql) return
        const id = uid()
        setExporting(id)
        try {
            const info = await ExportFull(tab.kind === 'duck' ? '' : tab.connId, id, shownSql, exportName())
            if (info?.path) onToast(`Exported ${info.rows} row${info.rows === 1 ? '' : 's'} to ${info.path}`)
            if (info?.truncated) report(`Export stopped at the row limit (${info.rows} rows); ${info.path} is incomplete.`, 'export', 'warn')
        } catch (e) { onError(String(e).replace(/^Error: /, '')) }
        finally { setExporting('') }
    }
    const canFullExport = !!shownSql && (tab.kind === 'duck' || live)

    const chips = (() => {
        if (exporting) return <><span className="chip run"><span className="spinner"/>Exporting…</span><button className="btn sm" onClick={() => CancelQuery(exporting)}>Cancel</button></>
        if (running) return <span className="chip run"><span className="spinner"/>Running…</span>
        if (err || !r) return null
        if (!hasRows) return <><span className="chip ok"><Icon name="check" size={12} color="currentColor"/>{r.message || 'OK'}</span><span className="chip">{r.elapsedMs} ms</span></>
        return <>
            <span className="chip">{r.rows.length} row{r.rows.length === 1 ? '' : 's'}</span>
            <span className="chip">{r.elapsedMs} ms</span>
            {r.truncated && <span className="chip warn" title="Only the first rows are shown">truncated</span>}
            {r.message && <span className="chip">{r.message}</span>}
            {pinned && <span className="chip pin" title={`Pinned at ${new Date(pinned.at).toLocaleTimeString()}. Not saved anywhere until you use Save to DuckDB.`}><Icon name="pin" size={12} color="currentColor"/>pinned · memory only</span>}
        </>
    })()

    return (
        <div className="console" onClick={() => exportMenu && setExportMenu(null)}>
            {exportMenu && r && (
                <ContextMenu x={exportMenu.x} y={exportMenu.y} onClose={() => setExportMenu(null)}>
                    <MenuItem icon="download" onClick={exportLoaded}>Loaded rows ({r.rows.length}{r.truncated ? '+' : ''})</MenuItem>
                    <MenuItem icon="download" hint={canFullExport ? undefined : 'not connected'} onClick={() => canFullExport && exportFull()}>Full query result</MenuItem>
                </ContextMenu>
            )}
            <div className="toolbar">
                {tab.running
                    ? <button className="tb stop" title="Cancel the running query" onClick={onCancel}><Icon name="stop" size={14}/>Stop</button>
                    : <button className="tb run" title={`Run (${runKey})`} disabled={!live} onClick={() => run.current()}><Icon name="play" size={14}/>Run</button>}
                <span className="tb-sep"/>
                {choices && onPickConn
                    ? <span className="tb-label">
                        <Icon name={kindIcon(tab.kind)} size={14}/>
                        <select className="conn-pick" aria-label="Connection" value={tab.kind === 'duck' ? 'duck' : tab.connId} onChange={e => onPickConn(e.target.value)}>
                            <option value="">Choose connection…</option>
                            {choices.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                        {!live && tab.connId !== '' && tab.kind !== 'duck' && <span className="offline">not connected</span>}
                    </span>
                    : <span className="tb-label"><Icon name={kindIcon(tab.kind)} size={14}/>{connName}{!live && tab.kind !== 'duck' && <span className="offline">not connected</span>}</span>}
                <span className="spacer"/>
                <span className="hint">{tab.kind === 'redis'
                    ? <><kbd>{runKey}</kbd> runs the current line</>
                    : <><kbd>{runKey}</kbd> runs the selection or current statement</>}</span>
            </div>
            <div className="editor" style={{height: split}}>
                <Editor
                    path={path}
                    language={lang}
                    theme={resolved === 'dark' ? 'darcula' : 'clutch-light'}
                    value={tab.sql}
                    onChange={v => onChange({sql: v ?? ''})}
                    onMount={onMount}
                    options={{
                        minimap: {enabled: prefs.minimap}, fontSize: prefs.fontSize, lineNumbers: prefs.lineNumbers ? 'on' : 'off', lineNumbersMinChars: 3, scrollBeyondLastLine: false,
                        automaticLayout: true, quickSuggestions: {other: true, strings: false, comments: false},
                        suggestOnTriggerCharacters: true, fontFamily: monoFont, fontLigatures: false,
                        padding: {top: 8}, renderLineHighlight: 'line', fixedOverflowWidgets: true,
                        scrollbar: {verticalScrollbarSize: 10, horizontalScrollbarSize: 10}, overviewRulerBorder: false, roundedSelection: false, tabSize: prefs.tabSize, wordWrap: prefs.wordWrap ? 'on' : 'off',
                    }}
                />
            </div>
            <div className="splitter" role="separator" aria-orientation="horizontal" title="Drag to resize" onMouseDown={drag}/>
            <div className="results">
                <div className="result-bar">
                    {chips}
                    <span className="spacer"/>
                    {hasRows && <button className="btn sm" disabled={!!exporting} aria-haspopup="menu" onClick={e => { e.stopPropagation(); const b = e.currentTarget.getBoundingClientRect(); setExportMenu({x: b.left, y: b.bottom + 2}) }}><Icon name="download" size={14}/>Export CSV</button>}
                    {!pinned && hasRows && <button className="btn sm" disabled={!canPin} title={pins.length >= MAX_PINS ? `Limit of ${MAX_PINS} pinned results: close one first` : 'Keep this result; later runs will not replace it'} onClick={pin}><Icon name="pin" size={14}/>Pin</button>}
                    {canSave && <button className="btn sm" title="Re-run this statement and save its full result into the local DuckDB" onClick={() => onSave(shownSql!)}><Icon name="save" size={14}/>Save to DuckDB</button>}
                </div>
                {pins.length > 0 && (
                    <div className="rs-tabs" role="tablist">
                        <div role="tab" aria-selected={view === 'live'} tabIndex={0} className={`rs-tab ${view === 'live' ? 'active' : ''}`} onClick={() => setView('live')}
                             onKeyDown={e => e.key === 'Enter' && setView('live')}>Latest</div>
                        {pins.map(p => (
                            <div key={p.id} role="tab" aria-selected={view === p.id} tabIndex={0} className={`rs-tab pinned ${view === p.id ? 'active' : ''}`}
                                 title={`${p.sql}\n\n${p.result.rows.length} rows · ${new Date(p.at).toLocaleTimeString()}`}
                                 onClick={() => setView(p.id)} onDoubleClick={() => setRenaming(p.id)}
                                 onKeyDown={e => e.key === 'Enter' && setView(p.id)}>
                                <Icon name="pin" size={12} color="currentColor"/>
                                {renaming === p.id
                                    ? <input autoFocus defaultValue={p.title} className="rs-rename" onClick={e => e.stopPropagation()}
                                             onBlur={e => rename(p.id, e.target.value)}
                                             onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') rename(p.id, e.currentTarget.value); if (e.key === 'Escape') setRenaming('') }}/>
                                    : <span className="rs-title">{p.title}</span>}
                                <button className="x" title="Close pinned result" aria-label="Close pinned result" onClick={e => { e.stopPropagation(); unpin(p.id) }}><Icon name="close" size={12} color="currentColor"/></button>
                            </div>
                        ))}
                    </div>
                )}
                <div className="result-body">
                    {err && <pre className="error"><Icon name="alert" size={14}/>{err}</pre>}
                    {!err && r && r.columns.length > 0 && <ResultGrid key={pinned?.id ?? 'live'} result={r}/>}
                    {!err && r && r.columns.length === 0 && <div className="empty">{r.message || 'Done.'}</div>}
                    {!err && !r && !running && <div className="empty"><Icon name="table" size={26} color="var(--text-disabled)"/>Run a query to see results here.</div>}
                </div>
            </div>
        </div>
    )
})
