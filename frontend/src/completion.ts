import {monaco} from './monaco'
import {Schema, SchemaNode, Table} from './types'

export type Dialect = 'postgres' | 'duck' | 'redis'

export interface CompletionContext {
    dialect: Dialect
    schema?: Schema
}

// One context per editor model; the provider looks it up by model URI.
const contexts = new Map<string, CompletionContext>()
export const setContext = (uri: string, c: CompletionContext) => contexts.set(uri, c)
export const dropContext = (uri: string) => contexts.delete(uri)

const SQL_KEYWORDS = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL JOIN', 'CROSS JOIN', 'ON', 'AS', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'ILIKE', 'IS NULL', 'IS NOT NULL', 'DISTINCT', 'UNION', 'UNION ALL', 'WITH', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC', 'DESC', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'CAST', 'EXPLAIN', 'EXPLAIN ANALYZE', 'INSERT INTO', 'UPDATE', 'DELETE FROM', 'VALUES', 'SET', 'RETURNING', 'NULLS FIRST', 'NULLS LAST', 'OVER', 'PARTITION BY', 'FILTER', 'LATERAL', 'DESCRIBE', 'SUMMARIZE']

export const REDIS_COMMANDS = ['APPEND', 'BITCOUNT', 'DBSIZE', 'DEL', 'DUMP', 'EXISTS', 'EXPIRETIME', 'GET', 'GETRANGE', 'HEXISTS', 'HGET', 'HGETALL', 'HKEYS', 'HLEN', 'HMGET', 'HSCAN', 'HVALS', 'INFO', 'KEYS', 'LINDEX', 'LLEN', 'LRANGE', 'MEMORY USAGE', 'MGET', 'OBJECT ENCODING', 'OBJECT FREQ', 'OBJECT IDLETIME', 'PTTL', 'RANDOMKEY', 'SCAN', 'SCARD', 'SISMEMBER', 'SMEMBERS', 'SSCAN', 'STRLEN', 'TTL', 'TYPE', 'XINFO STREAM', 'XLEN', 'XRANGE', 'XREVRANGE', 'ZCARD', 'ZCOUNT', 'ZRANGE', 'ZRANK', 'ZREVRANGE', 'ZSCAN', 'ZSCORE', 'CONFIG GET', 'CLIENT LIST', 'SLOWLOG GET', 'SET', 'SETEX', 'INCR', 'DECR', 'HSET', 'HDEL', 'LPUSH', 'RPUSH', 'SADD', 'ZADD', 'EXPIRE', 'PERSIST', 'RENAME']

const NOT_ALIAS = new Set(['where', 'on', 'join', 'left', 'right', 'inner', 'full', 'cross', 'group', 'order', 'limit', 'offset', 'having', 'union', 'using', 'natural', 'set', 'values', 'returning', 'select', 'window', 'except', 'intersect', 'for', 'lateral', 'tablesample'])
const unq = (s: string) => s.replace(/^"|"$/g, '')

function allTables(s?: Schema): {schema: SchemaNode; table: Table}[] {
    return (s?.schemas ?? []).flatMap(sc => sc.tables.map(t => ({schema: sc, table: t})))
}

function findTable(s: Schema | undefined, ref: string): {schema: SchemaNode; table: Table} | undefined {
    const parts = ref.split('.').map(unq)
    const all = allTables(s)
    if (parts.length >= 2) {
        const [sc, t] = parts.slice(-2)
        return all.find(x => x.schema.name === sc && x.table.name === t)
    }
    const hits = all.filter(x => x.table.name === parts[0])
    return hits.find(x => x.schema.name === 'public' || x.schema.name === 'main') ?? hits[0]
}

// Tables referenced in a statement, with their aliases.
export function referenced(stmt: string, s?: Schema) {
    const re = /\b(?:from|join|update|into)\s+((?:"[^"]+"|\w+)(?:\.(?:"[^"]+"|\w+))?)(?:\s+(?:as\s+)?("[^"]+"|\w+))?/gi
    const out: {alias?: string; schema: SchemaNode; table: Table}[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(stmt))) {
        const hit = findTable(s, m[1])
        if (!hit) continue
        const alias = m[2] && !NOT_ALIAS.has(m[2].toLowerCase()) ? unq(m[2]) : undefined
        out.push({alias, ...hit})
    }
    return out
}

function currentStatement(model: monaco.editor.ITextModel, pos: monaco.Position): string {
    const text = model.getValue()
    const off = model.getOffsetAt(pos)
    const before = text.lastIndexOf(';', off - 1) + 1
    const after = text.indexOf(';', off)
    return text.slice(before, after < 0 ? text.length : after)
}

const K = monaco.languages.CompletionItemKind

function provide(model: monaco.editor.ITextModel, pos: monaco.Position): monaco.languages.CompletionList {
    const ctx = contexts.get(model.uri.toString())
    const word = model.getWordUntilPosition(pos)
    const range = {startLineNumber: pos.lineNumber, endLineNumber: pos.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn}
    const suggestions: monaco.languages.CompletionItem[] = []
    if (!ctx) return {suggestions}

    if (ctx.dialect === 'redis') {
        for (const c of REDIS_COMMANDS) suggestions.push({label: c, kind: K.Function, insertText: c + ' ', range})
        return {suggestions}
    }

    const line = model.getLineContent(pos.lineNumber).slice(0, pos.column - 1)
    const qual = /((?:"[^"]+"|\w+))\.(\w*)$/.exec(line)
    const stmt = currentStatement(model, pos)
    const refs = referenced(stmt, ctx.schema)

    if (qual) {
        const q = unq(qual[1])
        const colStart = pos.column - qual[2].length
        const r = {...range, startColumn: colStart}
        const byAlias = refs.find(x => x.alias === q) ?? refs.find(x => !x.alias && x.table.name === q)
        const schemaHit = ctx.schema?.schemas.find(s => s.name === q)
        const tableHit = byAlias ?? (ctx.schema ? findTable(ctx.schema, q) : undefined)
        if (byAlias || (!schemaHit && tableHit)) {
            for (const c of (byAlias ?? tableHit)!.table.columns)
                suggestions.push({label: c.name, kind: K.Field, detail: c.type + (c.notNull ? ' not null' : ''), insertText: c.name, range: r, sortText: String(c.position).padStart(4, '0')})
        } else if (schemaHit) {
            for (const t of schemaHit.tables) suggestions.push({label: t.name, kind: K.Struct, detail: t.kind, insertText: t.name, range: r})
            for (const f of schemaHit.functions) suggestions.push({label: f.name, kind: K.Function, detail: `(${f.args})`, insertText: f.name, range: r})
        }
        return {suggestions}
    }

    // columns of tables already in the statement come first
    for (const x of refs)
        for (const c of x.table.columns)
            suggestions.push({label: c.name, kind: K.Field, detail: `${x.alias ?? x.table.name}.${c.name} ${c.type}`, insertText: c.name, range, sortText: '0' + c.name})
    const seen = new Set<string>()
    for (const sc of ctx.schema?.schemas ?? []) {
        if (!seen.has(sc.name)) { seen.add(sc.name); suggestions.push({label: sc.name, kind: K.Module, insertText: sc.name, range, sortText: '2' + sc.name}) }
        const pub = sc.name === 'public' || sc.name === 'main'
        for (const t of sc.tables) {
            suggestions.push({label: t.name, kind: K.Struct, detail: `${sc.name}.${t.name} (${t.kind})`, insertText: t.name, range, sortText: (pub ? '1' : '3') + t.name})
            if (!pub) suggestions.push({label: `${sc.name}.${t.name}`, kind: K.Struct, detail: t.kind, insertText: `${sc.name}.${t.name}`, range, sortText: '3' + sc.name + t.name})
        }
        for (const f of sc.functions) suggestions.push({label: f.name, kind: K.Function, detail: `${sc.name}.${f.name}(${f.args})`, insertText: f.name, range, sortText: '4' + f.name})
    }
    for (const k of SQL_KEYWORDS) suggestions.push({label: k, kind: K.Keyword, insertText: k, range, sortText: '5' + k})
    return {suggestions}
}

let registered = false
export function registerCompletion() {
    if (registered) return
    registered = true
    for (const lang of ['sql', 'redis']) {
        if (lang === 'redis') monaco.languages.register({id: 'redis'})
        monaco.languages.registerCompletionItemProvider(lang, {
            triggerCharacters: ['.', ' '],
            provideCompletionItems: (model, pos) => provide(model, pos),
        })
    }
}
