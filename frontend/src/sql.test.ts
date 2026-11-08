import {describe, expect, it} from 'vitest'
import {destructiveReason, splitStatements, statementAt} from './sql'

const texts = (s: string) => splitStatements(s).map(sp => s.slice(sp.start, sp.end).trim())

describe('splitStatements', () => {
    it('splits on semicolons and drops blanks', () => {
        expect(texts('select 1; select 2;;\n  ')).toEqual(['select 1', 'select 2'])
    })
    it('ignores semicolons in strings, identifiers, comments and dollar quotes', () => {
        expect(texts(`select 'a;b'; select "c;d"`)).toEqual([`select 'a;b'`, `select "c;d"`])
        expect(texts(`select 1 -- ; x\n; select 2`)).toEqual(['select 1 -- ; x', 'select 2'])
        expect(texts('select 1 /* ; */; select 2')).toEqual(['select 1 /* ; */', 'select 2'])
        expect(texts('select $$a;b$$; select 2')).toEqual(['select $$a;b$$', 'select 2'])
        expect(texts('select $t$a;b$t$; select 2')).toEqual(['select $t$a;b$t$', 'select 2'])
    })
    it('handles doubled quotes', () => {
        expect(texts(`select 'it''s;ok'; select 2`)).toEqual([`select 'it''s;ok'`, 'select 2'])
    })
    it('tolerates unterminated input', () => {
        expect(texts(`select 'oops; select 2`)).toHaveLength(1)
        expect(texts('select 1 /* never closed; x')).toHaveLength(1)
    })
})

describe('statementAt', () => {
    const sql = 'select 1;\nselect 2;\n\nselect 3'
    it('picks the statement under the cursor', () => {
        expect(statementAt(sql, 3)).toBe('select 1')
        expect(statementAt(sql, 12)).toBe('select 2')
        expect(statementAt(sql, sql.length)).toBe('select 3')
    })
    it('treats the cursor right after a semicolon as still in that statement', () => {
        expect(statementAt(sql, 9)).toBe('select 1')
        expect(statementAt(sql, 19)).toBe('select 2')
    })
    it('falls back to the previous statement in blank space', () => {
        expect(statementAt(sql, sql.indexOf('\n\n') + 1)).toBe('select 2')
    })
    it('returns empty for blank text', () => {
        expect(statementAt('  \n ', 1)).toBe('')
    })
})

describe('destructiveReason', () => {
    it('flags DROP and TRUNCATE', () => {
        expect(destructiveReason('drop table t', 'postgres')).toMatch(/DROP/)
        expect(destructiveReason('  TRUNCATE t', 'duck')).toMatch(/TRUNCATE/)
    })
    it('flags DELETE/UPDATE without WHERE only', () => {
        expect(destructiveReason('delete from t', 'postgres')).toMatch(/DELETE/)
        expect(destructiveReason('update t set a = 1', 'postgres')).toMatch(/UPDATE/)
        expect(destructiveReason('delete from t where id = 1', 'postgres')).toBeNull()
    })
    it('looks at every statement and ignores comments', () => {
        expect(destructiveReason('select 1; drop table t', 'postgres')).toMatch(/DROP/)
        expect(destructiveReason('/* drop table t */ select 1', 'postgres')).toBeNull()
        expect(destructiveReason('select 1 -- delete from t', 'postgres')).toBeNull()
    })
    it('flags Redis FLUSHALL/FLUSHDB', () => {
        expect(destructiveReason('flushall', 'redis')).toMatch(/FLUSHALL/)
        expect(destructiveReason('get key', 'redis')).toBeNull()
    })
})
