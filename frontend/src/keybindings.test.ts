import {beforeAll, describe, expect, it, vi} from 'vitest'

// keybindings.ts reads navigator.platform when it loads
vi.stubGlobal('navigator', {platform: 'Linux x86_64'})
type KB = typeof import('./keybindings')
let kb: KB
beforeAll(async () => { kb = await import('./keybindings') })

const ev = (o: Partial<KeyboardEvent>) => ({key: '', code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o}) as KeyboardEvent

describe('comboFromEvent', () => {
    it('maps Ctrl and Cmd to Mod', () => {
        expect(kb.comboFromEvent(ev({key: 's', code: 'KeyS', ctrlKey: true}))).toBe('Mod+S')
        expect(kb.comboFromEvent(ev({key: 's', code: 'KeyS', metaKey: true}))).toBe('Mod+S')
    })
    it('keeps modifiers in canonical order', () => {
        expect(kb.comboFromEvent(ev({key: 'O', code: 'KeyO', ctrlKey: true, shiftKey: true}))).toBe('Mod+Shift+O')
        expect(kb.comboFromEvent(ev({key: 'x', code: 'KeyX', ctrlKey: true, altKey: true, shiftKey: true}))).toBe('Mod+Alt+Shift+X')
    })
    it('keeps Ctrl apart for Ctrl+Tab and uses the physical key for punctuation', () => {
        expect(kb.comboFromEvent(ev({key: 'Tab', code: 'Tab', ctrlKey: true}))).toBe('Ctrl+Tab')
        expect(kb.comboFromEvent(ev({key: ',', code: 'Comma', ctrlKey: true}))).toBe('Mod+,')
    })
    it('ignores bare modifier presses', () => {
        expect(kb.comboFromEvent(ev({key: 'Control', ctrlKey: true}))).toBeNull()
    })
})

describe('validCombo', () => {
    it('rejects plain typing but allows Esc, F-keys and Shift+Enter', () => {
        expect(kb.validCombo('A')).toBe(false)
        expect(kb.validCombo('Shift+A')).toBe(false)
        expect(kb.validCombo('Mod+A')).toBe(true)
        expect(kb.validCombo('Escape')).toBe(true)
        expect(kb.validCombo('F5')).toBe(true)
        expect(kb.validCombo('Shift+Enter')).toBe(true)
    })
})

describe('effective / conflictOf', () => {
    it('applies overrides, including unbinding with an empty string', () => {
        const b = kb.effective({'file.save': 'Mod+Alt+S', 'file.new': ''})
        expect(b['file.save']).toBe('Mod+Alt+S')
        expect(b['file.new']).toBe('')
        expect(b['file.open']).toBe('Mod+O')
    })
    it('detects conflicts but not self or unbound combos', () => {
        const b = kb.effective(null)
        expect(kb.conflictOf(b, 'file.new', 'Mod+O')?.id).toBe('file.open')
        expect(kb.conflictOf(b, 'file.open', 'Mod+O')).toBeUndefined()
        expect(kb.conflictOf(b, 'file.new', '')).toBeUndefined()
    })
    it('ships defaults without duplicate combos', () => {
        const keys = kb.COMMANDS.map(c => c.key)
        expect(new Set(keys).size).toBe(keys.length)
    })
})

describe('fmtCombo', () => {
    it('formats for non-Mac', () => {
        expect(kb.fmtCombo('Mod+Shift+S')).toBe('Ctrl+Shift+S')
        expect(kb.fmtCombo('')).toBe('Unassigned')
        expect(kb.fmtCombo('Escape')).toBe('Esc')
    })
})
