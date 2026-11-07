import {Fragment, ReactNode, useEffect, useState} from 'react'
import {Dialog} from './Dialog'
import {Icon, IconName} from './Icons'
import {McpPanel} from './McpPanel'
import {usePrefs} from './prefs'
import {COMMANDS, comboFromEvent, conflictOf, effective, fmtCombo, setRecording, validCombo} from './keybindings'

export type Section = 'appearance' | 'editor' | 'query' | 'keys' | 'mcp'

const SECTIONS: {id: Section; label: string; icon: IconName}[] = [
    {id: 'appearance', label: 'Appearance', icon: 'gear'},
    {id: 'editor', label: 'Editor', icon: 'edit'},
    {id: 'query', label: 'Query', icon: 'play'},
    {id: 'keys', label: 'Keyboard', icon: 'gear'},
    {id: 'mcp', label: 'MCP server', icon: 'plug'},
]

function Check({id, label, checked, onChange}: {id: string; label: string; checked: boolean; onChange: (v: boolean) => void}) {
    return (
        <>
            <span className="lbl"/>
            <label className="check" htmlFor={id}>
                <input id={id} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}/>
                {label}
            </label>
        </>
    )
}

// number input that only commits valid values, so clearing the field mid-edit doesn't clamp it
function Num({id, value, min, max, onChange, suffix}: {id: string; value: number; min: number; max: number; onChange: (v: number) => void; suffix?: string}) {
    return (
        <div className="inline">
            <input id={id} type="number" min={min} max={max} value={value} style={{width: 110}}
                   onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= min && n <= max) onChange(Math.round(n)) }}/>
            {suffix && <span className="hint">{suffix}</span>}
        </div>
    )
}

function Appearance() {
    const {prefs, update} = usePrefs()
    return (
        <>
            <h3>Appearance</h3>
            <div className="body" style={{gridTemplateColumns: '140px 1fr'}}>
                <label htmlFor="s-theme">Theme</label>
                <select id="s-theme" value={prefs.theme} onChange={e => update({theme: e.target.value})}>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                    <option value="system">Follow system</option>
                </select>
                <label htmlFor="s-density">Density</label>
                <select id="s-density" value={prefs.density} onChange={e => update({density: e.target.value})}>
                    <option value="comfortable">Comfortable</option>
                    <option value="compact">Compact</option>
                </select>
                <label htmlFor="s-font">Monospace font</label>
                <input id="s-font" type="text" placeholder="JetBrains Mono (default)" value={prefs.fontFamily} onChange={e => update({fontFamily: e.target.value})}/>
                <label htmlFor="s-fsize">Font size</label>
                <Num id="s-fsize" value={prefs.fontSize} min={9} max={32} suffix="px, editor and result grid" onChange={v => update({fontSize: v})}/>
            </div>
        </>
    )
}

function EditorPane() {
    const {prefs, update} = usePrefs()
    return (
        <>
            <h3>Editor</h3>
            <div className="body" style={{gridTemplateColumns: '140px 1fr'}}>
                <Check id="s-wrap" label="Word wrap" checked={prefs.wordWrap} onChange={v => update({wordWrap: v})}/>
                <Check id="s-mini" label="Minimap" checked={prefs.minimap} onChange={v => update({minimap: v})}/>
                <Check id="s-ln" label="Line numbers" checked={prefs.lineNumbers} onChange={v => update({lineNumbers: v})}/>
                <Check id="s-auto" label="Autosave file tabs one second after you stop typing" checked={prefs.autosave} onChange={v => update({autosave: v})}/>
                <label htmlFor="s-tab">Tab size</label>
                <Num id="s-tab" value={prefs.tabSize} min={1} max={8} suffix="spaces" onChange={v => update({tabSize: v})}/>
            </div>
        </>
    )
}

function QueryPane() {
    const {prefs, update} = usePrefs()
    return (
        <>
            <h3>Query</h3>
            <div className="body" style={{gridTemplateColumns: '140px 1fr'}}>
                <label htmlFor="s-rows">Row limit</label>
                <Num id="s-rows" value={prefs.rowLimit} min={1} max={100000} suffix="rows loaded per run" onChange={v => update({rowLimit: v})}/>
                <label htmlFor="s-timeout">Timeout</label>
                <Num id="s-timeout" value={prefs.timeoutSec} min={0} max={3600} suffix="seconds, 0 = none" onChange={v => update({timeoutSec: v})}/>
                <Check id="s-confirm" label="Confirm destructive statements (DROP, TRUNCATE, DELETE/UPDATE without WHERE, FLUSHALL)"
                       checked={prefs.confirmDestructive} onChange={v => update({confirmDestructive: v})}/>
                <div className="full hint">Applies to the next run. Servers that allow a single session stay protected by the timeout: a cancelled query releases the slot.</div>
            </div>
        </>
    )
}

function Keys() {
    const {prefs, update} = usePrefs()
    const overrides: Record<string, string> = prefs.keybindings ?? {}
    const bindings = effective(overrides)
    const [rec, setRec] = useState('')
    const [note, setNote] = useState('')

    const set = (id: string, combo: string) => {
        const def = COMMANDS.find(c => c.id === id)!.key
        const next = {...overrides}
        if (combo === def) delete next[id]
        else next[id] = combo
        update({keybindings: next})
    }

    useEffect(() => {
        if (!rec) return
        setRecording(true)
        const on = (e: KeyboardEvent) => {
            e.preventDefault(); e.stopPropagation()
            if (e.key === 'Escape') { setRec(''); setNote(''); return }
            const combo = comboFromEvent(e)
            if (!combo) return
            if (!validCombo(combo)) { setNote('Add Ctrl, Alt or Cmd so normal typing keeps working.'); return }
            const other = conflictOf(bindings, rec, combo)
            if (other) { setNote(`${fmtCombo(combo)} is already used by "${other.label}".`); return }
            set(rec, combo); setRec(''); setNote('')
        }
        window.addEventListener('keydown', on, true)
        return () => { window.removeEventListener('keydown', on, true); setRecording(false) }
    }, [rec, prefs.keybindings])

    const groups = [...new Set(COMMANDS.map(c => c.group))]
    return (
        <>
            <h3>Keyboard</h3>
            <div className="hint" style={{marginBottom: 'var(--sp-3)'}}>Click a shortcut, then press the new keys. Esc cancels.</div>
            {note && <div className="notice fail" role="alert" style={{marginBottom: 'var(--sp-3)'}}><div className="notice-body">{note}</div></div>}
            <table className="keys">
                <tbody>
                    {groups.map(g => (
                        <Fragment key={g}>
                            <tr><th colSpan={3}>{g}</th></tr>
                            {COMMANDS.filter(c => c.group === g).map(c => (
                                <tr key={c.id}>
                                    <td>{c.label}</td>
                                    <td>
                                        <button className={`keycap${rec === c.id ? ' rec' : ''}`} onClick={() => { setNote(''); setRec(rec === c.id ? '' : c.id) }}>
                                            {rec === c.id ? 'Press keys…' : fmtCombo(bindings[c.id])}
                                        </button>
                                    </td>
                                    <td className="k-act">
                                        {bindings[c.id] !== c.key && <button className="btn sm" onClick={() => set(c.id, c.key)}>Reset</button>}
                                        {bindings[c.id] !== '' && <button className="btn sm" onClick={() => { const next = {...overrides, [c.id]: ''}; update({keybindings: next}) }}>Clear</button>}
                                    </td>
                                </tr>
                            ))}
                        </Fragment>
                    ))}
                </tbody>
            </table>
            <div style={{marginTop: 'var(--sp-3)'}}><button className="btn" onClick={() => update({keybindings: {}})}>Reset all to defaults</button></div>
        </>
    )
}

export function SettingsDialog({initial = 'appearance', onClose}: {initial?: Section; onClose: () => void}) {
    const [section, setSection] = useState<Section>(initial)
    const pane: Record<Section, ReactNode> = {appearance: <Appearance/>, editor: <EditorPane/>, query: <QueryPane/>, keys: <Keys/>, mcp: <McpPanel/>}
    return (
        <Dialog title="Settings" icon="gear" width={800} onClose={onClose}
                footer={<><span className="hint">Changes are saved automatically.</span><div className="spacer"/><button className="btn primary" onClick={onClose}>Close</button></>}>
            <div className="settings">
                <nav className="settings-nav" aria-label="Settings sections">
                    {SECTIONS.map(s => (
                        <button key={s.id} className={section === s.id ? 'on' : ''} aria-current={section === s.id} onClick={() => setSection(s.id)}>
                            <Icon name={s.icon} size={14}/>{s.label}
                        </button>
                    ))}
                </nav>
                <div className="settings-pane">{pane[section]}</div>
            </div>
        </Dialog>
    )
}
