// Statement splitting: ';' outside quotes and comments.
export interface Span { start: number; end: number }

export function splitStatements(text: string): Span[] {
    const out: Span[] = []
    let start = 0
    let i = 0
    while (i < text.length) {
        const c = text[i]
        const n = text[i + 1]
        if (c === '-' && n === '-') { while (i < text.length && text[i] !== '\n') i++; continue }
        if (c === '/' && n === '*') { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 2; continue }
        if (c === "'" || c === '"') {
            i++
            while (i < text.length) {
                if (text[i] === c) { if (text[i + 1] === c) { i += 2; continue } break }
                i++
            }
            i++
            continue
        }
        if (c === '$' ) { // dollar-quoted string $tag$ ... $tag$
            const m = /^\$([A-Za-z_]*)\$/.exec(text.slice(i))
            if (m) { const e = text.indexOf(m[0], i + m[0].length); i = e < 0 ? text.length : e + m[0].length; continue }
        }
        if (c === ';') { out.push({start, end: i}); start = i + 1 }
        i++
    }
    out.push({start, end: text.length})
    return out.filter(s => text.slice(s.start, s.end).trim() !== '')
}

// The statement under the cursor; if the cursor sits in blank space, the nearest one before it.
export function statementAt(text: string, offset: number): string {
    const spans = splitStatements(text)
    if (spans.length === 0) return ''
    let pick = spans[0]
    for (const s of spans) {
        if (offset >= s.start) pick = s
        if (offset <= s.end) { pick = s; break }
    }
    return text.slice(pick.start, pick.end).trim()
}

// Statements worth a confirmation: DROP/TRUNCATE, DELETE/UPDATE without WHERE, Redis FLUSHALL/FLUSHDB.
export function destructiveReason(text: string, kind: 'postgres' | 'redis' | 'duck'): string | null {
    if (kind === 'redis') {
        const m = /^\s*(flushall|flushdb)\b/i.exec(text)
        return m ? `${m[1].toUpperCase()} removes data from the server.` : null
    }
    for (const sp of splitStatements(text)) {
        const stmt = text.slice(sp.start, sp.end).replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ').trim()
        const head = /^(drop|truncate|delete|update)\b/i.exec(stmt)?.[1].toLowerCase()
        if (head === 'drop' || head === 'truncate') return `${head.toUpperCase()} permanently removes data or objects.`
        if ((head === 'delete' || head === 'update') && !/\bwhere\b/i.test(stmt)) return `${head.toUpperCase()} without WHERE affects every row.`
    }
    return null
}
