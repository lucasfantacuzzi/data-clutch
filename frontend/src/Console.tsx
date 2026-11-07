import {useEffect, useRef, useState} from 'react'
import Editor, {OnMount} from '@monaco-editor/react'
import './monaco'
import {monaco} from './monaco'
import {dropContext, registerCompletion, setContext, Dialect} from './completion'
import {statementAt} from './sql'
import {GridHandle, ResultGrid} from './ResultGrid'
import {Icon, kindIcon} from './Icons'
import {Schema, Tab} from './types'

interface Props {
    tab: Tab
    connName: string
    live: boolean
    schema?: Schema
    onChange: (patch: Partial<Tab>) => void
    onRun: (sql: string) => void
    onCancel: () => void
    onSave: () => void
}

export function Console({tab, connName, live, schema, onChange, onRun, onCancel, onSave}: Props) {
    const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
    const grid = useRef<GridHandle>(null)
    const [split, setSplit] = useState(260)
    const run = useRef<() => void>(() => {})

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

    useEffect(() => { setContext(path, {dialect, schema}) }, [path, dialect, schema])
    useEffect(() => () => { dropContext(path) }, [path])

    // tabs opened with a ready-made query (table double-click) run once
    useEffect(() => {
        if (tab.autoRun && live) { onChange({autoRun: false}); onRun(tab.sql) }
    }, [tab.autoRun, live])

    const onMount: OnMount = (ed, m) => {
        registerCompletion()
        editor.current = ed
        ed.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Enter, () => run.current())
        ed.addCommand(m.KeyMod.Shift | m.KeyCode.Enter, () => run.current())
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

    const r = tab.result
    const canSave = !!r && r.columns.length > 0 && tab.kind !== 'duck' && !tab.running
    const hasRows = !!r && r.columns.length > 0
    const chips = (() => {
        if (tab.running) return <span className="chip run"><span className="spinner"/>Running…</span>
        if (tab.error || !r) return null
        if (!hasRows) return <><span className="chip ok"><Icon name="check" size={12} color="currentColor"/>{r.message || 'OK'}</span><span className="chip">{r.elapsedMs} ms</span></>
        return <>
            <span className="chip">{r.rows.length} row{r.rows.length === 1 ? '' : 's'}</span>
            <span className="chip">{r.elapsedMs} ms</span>
            {r.truncated && <span className="chip warn" title="Only the first rows are shown">truncated</span>}
            {r.message && <span className="chip">{r.message}</span>}
        </>
    })()

    return (
        <div className="console">
            <div className="toolbar">
                {tab.running
                    ? <button className="tb stop" title="Cancel the running query" onClick={onCancel}><Icon name="stop" size={14}/>Stop</button>
                    : <button className="tb run" title="Run (Ctrl+Enter)" disabled={!live} onClick={() => run.current()}><Icon name="play" size={14}/>Run</button>}
                <span className="tb-sep"/>
                <span className="tb-label"><Icon name={kindIcon(tab.kind)} size={14}/>{connName}{!live && tab.kind !== 'duck' && <span className="offline">not connected</span>}</span>
                <span className="spacer"/>
                <span className="hint">{tab.kind === 'redis'
                    ? <><kbd>Ctrl</kbd><kbd>Enter</kbd> runs the current line</>
                    : <><kbd>Ctrl</kbd><kbd>Enter</kbd> runs the selection or current statement</>}</span>
            </div>
            <div className="editor" style={{height: split}}>
                <Editor
                    path={path}
                    language={lang}
                    theme="darcula"
                    value={tab.sql}
                    onChange={v => onChange({sql: v ?? ''})}
                    onMount={onMount}
                    options={{
                        minimap: {enabled: false}, fontSize: 13, lineNumbersMinChars: 3, scrollBeyondLastLine: false,
                        automaticLayout: true, quickSuggestions: {other: true, strings: false, comments: false},
                        suggestOnTriggerCharacters: true, fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, Menlo, Consolas, monospace', fontLigatures: false,
                        padding: {top: 8}, renderLineHighlight: 'line', fixedOverflowWidgets: true,
                        scrollbar: {verticalScrollbarSize: 10, horizontalScrollbarSize: 10}, overviewRulerBorder: false, roundedSelection: false, tabSize: 2, wordWrap: 'off',
                    }}
                />
            </div>
            <div className="splitter" role="separator" aria-orientation="horizontal" title="Drag to resize" onMouseDown={drag}/>
            <div className="results">
                <div className="result-bar">
                    {chips}
                    <span className="spacer"/>
                    {hasRows && <button className="btn sm" onClick={() => grid.current?.exportCsv()}><Icon name="download" size={14}/>Export CSV</button>}
                    {canSave && <button className="btn sm" title="Save the full result of the last run into the local DuckDB" onClick={onSave}><Icon name="save" size={14}/>Save to DuckDB</button>}
                </div>
                <div className="result-body">
                    {tab.error && <pre className="error"><Icon name="alert" size={14}/>{tab.error}</pre>}
                    {!tab.error && r && r.columns.length > 0 && <ResultGrid ref={grid} result={r}/>}
                    {!tab.error && r && r.columns.length === 0 && <div className="empty">{r.message || 'Done.'}</div>}
                    {!tab.error && !r && !tab.running && <div className="empty"><Icon name="table" size={26} color="var(--text-disabled)"/>Run a query to see results here.</div>}
                </div>
            </div>
        </div>
    )
}
