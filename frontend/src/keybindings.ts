// Command registry + shortcut matching. Defaults live here; the user's overrides
// come from prefs.keybindings (command id -> combo, "" = unbound).

export interface Command { id: string; label: string; group: string; key: string }

export const COMMANDS: Command[] = [
    {id: 'file.new', label: 'New query tab', group: 'File', key: 'Mod+N'},
    {id: 'file.open', label: 'Open file…', group: 'File', key: 'Mod+O'},
    {id: 'file.openFolder', label: 'Open folder…', group: 'File', key: 'Mod+Shift+O'},
    {id: 'file.save', label: 'Save', group: 'File', key: 'Mod+S'},
    {id: 'file.saveAs', label: 'Save as…', group: 'File', key: 'Mod+Shift+S'},
    {id: 'tab.close', label: 'Close tab', group: 'Navigation', key: 'Mod+W'},
    {id: 'tab.next', label: 'Next tab', group: 'Navigation', key: 'Ctrl+Tab'},
    {id: 'tab.prev', label: 'Previous tab', group: 'Navigation', key: 'Ctrl+Shift+Tab'},
    {id: 'nav.quickOpen', label: 'Go to file…', group: 'Navigation', key: 'Mod+P'},
    {id: 'view.sidebar', label: 'Toggle sidebar', group: 'Navigation', key: 'Mod+B'},
    {id: 'settings.open', label: 'Open settings', group: 'Navigation', key: 'Mod+,'},
    {id: 'query.run', label: 'Run statement', group: 'Query', key: 'Mod+Enter'},
    {id: 'query.runAlt', label: 'Run statement (alternate)', group: 'Query', key: 'Shift+Enter'},
    {id: 'query.cancel', label: 'Cancel running query', group: 'Query', key: 'Escape'},
]

export type Bindings = Record<string, string>

export function effective(overrides: Record<string, string> | null | undefined): Bindings {
    const out: Bindings = {}
    for (const c of COMMANDS) out[c.id] = overrides && c.id in overrides ? overrides[c.id] : c.key
    return out
}

const CODE_KEYS: Record<string, string> = {Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Minus: '-', Equal: '=', Backquote: '`', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Quote: "'", Space: 'Space'}

// Canonical form: modifiers in fixed order (Mod, Ctrl, Alt, Shift) then the key.
// Mod = Ctrl or Cmd, so one default works on every platform. Ctrl is kept apart
// only where it must be (Ctrl+Tab).
export function comboFromEvent(e: KeyboardEvent): string | null {
    if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return null
    let key = e.key
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5)
    else if (CODE_KEYS[e.code]) key = CODE_KEYS[e.code]
    else if (key.length === 1) key = key.toUpperCase()
    const parts: string[] = []
    if (key === 'Tab' && e.ctrlKey) parts.push('Ctrl')
    else if (e.ctrlKey || e.metaKey) parts.push('Mod')
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')
    parts.push(key)
    return parts.join('+')
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform)

export function fmtCombo(combo: string): string {
    if (!combo) return 'Unassigned'
    return combo.split('+').map(p => (p === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : p === 'Escape' ? 'Esc' : p)).join(isMac ? '' : '+')
}

// A combo with no modifier (other than Shift) is only allowed for a few keys, so
// plain typing is never hijacked.
export function validCombo(combo: string): boolean {
    const parts = combo.split('+')
    const key = parts[parts.length - 1]
    const hasMod = parts.some(p => p === 'Mod' || p === 'Ctrl' || p === 'Alt')
    return hasMod || key === 'Escape' || /^F\d{1,2}$/.test(key) || (parts.includes('Shift') && key === 'Enter')
}

export function conflictOf(bindings: Bindings, id: string, combo: string): Command | undefined {
    if (!combo) return undefined
    return COMMANDS.find(c => c.id !== id && bindings[c.id] === combo)
}

let recording = false
export const setRecording = (on: boolean) => { recording = on }

export type Handlers = Record<string, () => boolean | void>

// Installs the global shortcut listener (capture phase, so it wins over Monaco).
// A handler returning false declines the key and lets it through untouched.
export function installShortcuts(getBindings: () => Bindings, getHandlers: () => Handlers): () => void {
    const onKey = (e: KeyboardEvent) => {
        if (recording || e.isComposing) return
        const combo = comboFromEvent(e)
        if (!combo) return
        const b = getBindings()
        const id = COMMANDS.find(c => b[c.id] === combo)?.id
        if (!id) return
        const h = getHandlers()[id]
        if (!h) return
        if (h() !== false) { e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
}
