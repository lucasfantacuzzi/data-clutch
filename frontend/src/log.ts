import {useSyncExternalStore} from 'react'

export type Level = 'error' | 'warn' | 'info'
export interface Entry {id: number; time: number; level: Level; source: string; text: string}

const MAX = 500
let entries: Entry[] = []
let unread = 0
let seq = 0
const subs = new Set<() => void>()
let snap = {entries, unread}

const emit = () => { snap = {entries, unread}; subs.forEach(f => f()) }

export const errText = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error: /, '')

// report records a message in the Output panel; the status bar shows the unread count.
export function report(e: unknown, source: string, level: Level = 'error') {
    entries = [...entries, {id: ++seq, time: Date.now(), level, source, text: errText(e)}].slice(-MAX)
    unread++
    emit()
}
export const markRead = () => { if (unread) { unread = 0; emit() } }
export const clearLog = () => { entries = []; unread = 0; emit() }

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
export const useLog = () => useSyncExternalStore(subscribe, () => snap)
