import {useEffect, useMemo, useRef, useState} from 'react'
import Editor, {OnMount} from '@monaco-editor/react'
import './monaco'
import {monaco} from './monaco'
import {dropContext, registerCompletion, setContext, Dialect} from './completion'
import {statementAt} from './sql'
import {GridHandle, ResultGrid} from './ResultGrid'
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
    const info = useMemo(() => {
        if (tab.running) return 'Running…'
        if (tab.error) return ''
        if (!r) return ''
        if (r.columns.length === 0) return `${r.message || 'OK'} · ${r.elapsedMs} ms`
        return `${r.rows.length} row${r.rows.length === 1 ? '' : 's'}${r.truncated ? ' (truncated)' : ''} · ${r.elapsedMs} ms${r.message ? ' · ' + r.message : ''}`
    }, [r, tab.running, tab.error])

    return (
        <div className="console">
            <div className="toolbar">
                {tab.running
                    ? <button className="tb stop" title="Cancel the running query" onClick={onCancel}>■ Stop</button>
                    : <button className="tb run" title="Run (Ctrl+Enter)" disabled={!live} onClick={() => run.current()}>▶ Run</button>}
                <span className="tb-sep"/>
                <span className="tb-label">{tab.kind === 'duck' ? '🦆 ' : ''}{connName}{!live && tab.kind !== 'duck' ? ' — not connected' : ''}</span>
                <span className="spacer"/>
                <span className="hint">{tab.kind === 'redis' ? 'Ctrl+Enter runs the current line' : 'Ctrl+Enter runs the selection or current statement'}</span>
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
                        suggestOnTriggerCharacters: true, fontFamily: 'ui-monospace, "JetBrains Mono", "Fira Code", Menlo, Consolas, monospace',
                        padding: {top: 6}, renderLineHighlight: 'line', tabSize: 2, wordWrap: 'off',
                    }}
                />
            </div>
            <div className="splitter" onMouseDown={drag}/>
            <div className="results">
                <div className="result-bar">
                    <span>{info}</span>
                    <span className="spacer"/>
                    {r && r.columns.length > 0 && <button className="tb" onClick={() => grid.current?.exportCsv()}>Export CSV</button>}
                    {canSave && <button className="tb" title="Save the full result of the last run into the local DuckDB" onClick={onSave}>💾 Save to DuckDB</button>}
                </div>
                <div className="result-body">
                    {tab.error && <pre className="error">{tab.error}</pre>}
                    {!tab.error && r && r.columns.length > 0 && <ResultGrid ref={grid} result={r}/>}
                    {!tab.error && r && r.columns.length === 0 && <div className="empty">{r.message || 'Done.'}</div>}
                    {!tab.error && !r && !tab.running && <div className="empty">Run a query to see results here.</div>}
                </div>
            </div>
        </div>
    )
}
