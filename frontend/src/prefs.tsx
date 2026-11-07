import {createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react'
import {GetPrefs, SetPrefs} from '../wailsjs/go/main/App'
import {store} from '../wailsjs/go/models'

export type Prefs = store.Prefs
export type Resolved = 'dark' | 'light'

export const MONO = '"JetBrains Mono", "Fira Code", ui-monospace, Menlo, Consolas, monospace'

// Mirrors store.DefaultPrefs; used until the backend answers.
const DEFAULTS = store.Prefs.createFrom({
    theme: 'dark', fontFamily: '', fontSize: 13, density: 'comfortable',
    wordWrap: false, minimap: false, lineNumbers: true, tabSize: 2, autosave: false,
    rowLimit: 1000, timeoutSec: 0, confirmDestructive: true,
    sidebarWidth: 280, keybindings: {}, recentFolders: [], lastFolder: '',
})

interface Ctx {
    prefs: Prefs
    resolved: Resolved
    monoFont: string
    update: (patch: Partial<Prefs>) => void
    reload: () => void // re-read from the backend (it changes recent folders itself)
}

const PrefsContext = createContext<Ctx>({prefs: DEFAULTS, resolved: 'dark', monoFont: MONO, update: () => {}, reload: () => {}})
export const usePrefs = () => useContext(PrefsContext)

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)')

export function PrefsProvider({children}: {children: ReactNode}) {
    const [prefs, setPrefs] = useState<Prefs>(DEFAULTS)
    const [ready, setReady] = useState(false)
    const [sysDark, setSysDark] = useState(() => systemDark().matches)
    const latest = useRef(prefs)
    const timer = useRef<number | undefined>(undefined)

    useEffect(() => {
        GetPrefs().then(p => { latest.current = p; setPrefs(p) }).catch(() => {}).finally(() => setReady(true))
    }, [])

    useEffect(() => {
        const mq = systemDark()
        const on = () => setSysDark(mq.matches)
        mq.addEventListener('change', on)
        return () => mq.removeEventListener('change', on)
    }, [])

    const resolved: Resolved = prefs.theme === 'system' ? (sysDark ? 'dark' : 'light') : prefs.theme === 'light' ? 'light' : 'dark'
    const monoFont = prefs.fontFamily ? `${prefs.fontFamily}, ${MONO}` : MONO

    useEffect(() => {
        const el = document.documentElement
        el.dataset.theme = resolved
        el.dataset.density = prefs.density
        if (prefs.fontFamily) el.style.setProperty('--mono', monoFont)
        else el.style.removeProperty('--mono')
    }, [resolved, prefs.density, prefs.fontFamily, monoFont])

    // optimistic local update, debounced write so typing a font size doesn't hit the disk per key
    const update = useCallback((patch: Partial<Prefs>) => {
        const next = store.Prefs.createFrom({...latest.current, ...patch})
        latest.current = next
        setPrefs(next)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => {
            const sent = latest.current
            SetPrefs(sent).then(p => { if (latest.current === sent) { latest.current = p; setPrefs(p) } }).catch(() => {})
        }, 250)
    }, [])

    const reload = useCallback(() => {
        GetPrefs().then(p => { latest.current = p; setPrefs(p) }).catch(() => {})
    }, [])

    const value = useMemo(() => ({prefs, resolved, monoFont, update, reload}), [prefs, resolved, monoFont, update, reload])
    if (!ready) return null
    return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
}
