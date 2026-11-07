import {useState} from 'react'
import {conn} from '../wailsjs/go/models'
import {SaveConnection, TestConnection} from '../wailsjs/go/main/App'
import {Dialog, Notice} from './Dialog'
import {Icon} from './Icons'

const DEFAULTS: Record<string, Partial<conn.Config>> = {
    postgres: {port: 5432, user: 'postgres', database: 'postgres', sslMode: 'prefer'},
    redis: {port: 6379, user: '', database: '0', sslMode: 'disable'},
}

export function emptyConfig(kind = 'postgres'): conn.Config {
    return conn.Config.createFrom({id: '', name: '', kind, host: 'localhost', password: '', readOnly: true, ...DEFAULTS[kind]})
}

interface Props {
    initial: conn.Config
    onClose: () => void
    onSaved: (c: conn.Config) => void
}

export function ConnectionDialog({initial, onClose, onSaved}: Props) {
    const [c, setC] = useState<conn.Config>(initial)
    const [testing, setTesting] = useState(false)
    const [result, setResult] = useState<conn.TestResult | null>(null)
    const [error, setError] = useState('')
    const editing = initial.id !== ''
    const set = (patch: Partial<conn.Config>) => { setC(conn.Config.createFrom({...c, ...patch})); setResult(null) }

    const test = async () => {
        setTesting(true); setResult(null)
        try { setResult(await TestConnection(c)) }
        catch (e) { setResult(conn.TestResult.createFrom({ok: false, message: String(e)})) }
        finally { setTesting(false) }
    }

    const save = async () => {
        try {
            const toSave = conn.Config.createFrom({...c, name: c.name.trim() || `${c.host}/${c.database}`})
            onSaved(await SaveConnection(toSave))
        } catch (e) { setError(String(e)) }
    }

    const changeKind = (kind: string) => setC(conn.Config.createFrom({...c, kind, ...DEFAULTS[kind]}))

    return (
        <Dialog title={editing ? 'Edit connection' : 'New connection'} icon={c.kind === 'redis' ? 'redis' : 'postgres'} onClose={onClose}
                footer={<>
                    <button className="btn" onClick={test} disabled={testing || !c.host}>
                        {testing ? <span className="spinner"/> : <Icon name="plug" size={14}/>}{testing ? 'Testing…' : 'Test Connection'}
                    </button>
                    <div className="spacer"/>
                    <button className="btn" onClick={onClose}>Cancel</button>
                    <button className="btn primary" onClick={save} disabled={!c.host}>Save</button>
                </>}>
            <div className="body">
                <label htmlFor="c-name">Name</label>
                <input id="c-name" type="text" value={c.name} placeholder={`${c.host}/${c.database}`} autoFocus onChange={e => set({name: e.target.value})}/>
                <label htmlFor="c-kind">Type</label>
                <select id="c-kind" value={c.kind} disabled={editing} onChange={e => changeKind(e.target.value)}>
                    <option value="postgres">PostgreSQL</option>
                    <option value="redis">Redis</option>
                </select>
                <label htmlFor="c-host">Host</label>
                <input id="c-host" type="text" value={c.host} onChange={e => set({host: e.target.value})}/>
                <label htmlFor="c-port">Port</label>
                <input id="c-port" type="number" value={c.port} onChange={e => set({port: Number(e.target.value)})}/>
                <label htmlFor="c-user">{c.kind === 'redis' ? 'User (ACL)' : 'User'}</label>
                <input id="c-user" type="text" value={c.user} onChange={e => set({user: e.target.value})}/>
                <label htmlFor="c-pass">Password</label>
                <input id="c-pass" type="password" value={c.password ?? ''} placeholder={editing ? '(unchanged)' : ''} onChange={e => set({password: e.target.value})}/>
                <label htmlFor="c-db">{c.kind === 'redis' ? 'DB index' : 'Database'}</label>
                <input id="c-db" type="text" value={c.database} onChange={e => set({database: e.target.value})}/>
                {c.kind === 'postgres' && <>
                    <label htmlFor="c-ssl">SSL mode</label>
                    <select id="c-ssl" value={c.sslMode} onChange={e => set({sslMode: e.target.value})}>
                        {['disable', 'prefer', 'require', 'verify-ca', 'verify-full'].map(m => <option key={m}>{m}</option>)}
                    </select>
                </>}
                <span/>
                <label className="check" htmlFor="ro">
                    <input id="ro" type="checkbox" checked={c.readOnly} onChange={e => set({readOnly: e.target.checked})}/>
                    Read-only
                </label>
                <div className="full hint">
                    This server accepts a single session. Testing while no session is open uses that one slot
                    briefly and releases it right away; with a session open, the test runs through it.
                </div>
                {result && (
                    <Notice kind={result.ok ? 'ok' : 'fail'}>
                        <b>{result.ok ? 'Succeeded' : 'Failed'}</b>
                        {result.ok && result.version ? ` — ${result.version}` : ''}
                        {result.ok ? ` (${result.latencyMs} ms)` : ''}
                        <div>{result.message}</div>
                    </Notice>
                )}
                {error && <Notice kind="fail">{error}</Notice>}
            </div>
        </Dialog>
    )
}
