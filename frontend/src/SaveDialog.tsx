import {useState} from 'react'
import {SaveQueryToDuck} from '../wailsjs/go/main/App'

interface Props {
    connId: string
    connName: string
    sql: string
    onClose: () => void
    onSaved: (table: string, rows: number) => void
}

const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')

export function suggestName(connName: string, sql: string) {
    const m = /\bfrom\s+(?:"?\w+"?\.)?"?(\w+)"?/i.exec(sql)
    return `${connName}_${m ? m[1] : 'query'}_${stamp()}`.replace(/[^a-zA-Z0-9_]+/g, '_').toLowerCase()
}

export function SaveDialog({connId, connName, sql, onClose, onSaved}: Props) {
    const [name, setName] = useState(suggestName(connName, sql))
    const [mode, setMode] = useState('create')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')

    const save = async () => {
        setBusy(true); setError('')
        try {
            const info = await SaveQueryToDuck(connId, 'save-' + Date.now(), sql, name, mode)
            onSaved(info.table, info.rows)
        } catch (e) { setError(String(e)); setBusy(false) }
    }

    return (
        <div className="overlay" onMouseDown={e => e.target === e.currentTarget && !busy && onClose()}>
            <div className="dialog" style={{width: 480}}>
                <h2>Save result to DuckDB</h2>
                <div className="body">
                    <label>Table</label>
                    <input type="text" value={name} autoFocus onChange={e => setName(e.target.value)}/>
                    <label>If it exists</label>
                    <select value={mode} onChange={e => setMode(e.target.value)}>
                        <option value="create">Fail (create new)</option>
                        <option value="replace">Replace</option>
                        <option value="append">Append rows</option>
                    </select>
                    <div className="full hint">
                        The statement runs again on this connection and the whole result is streamed into DuckDB
                        (not only the rows shown). Nothing is changed if it fails or is cancelled.
                    </div>
                    <pre className="full sqlpreview">{sql}</pre>
                    {error && <div className="full test-result fail">{error}</div>}
                </div>
                <div className="foot">
                    <div className="spacer"/>
                    <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
                    <button className="btn primary" onClick={save} disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
                </div>
            </div>
        </div>
    )
}
