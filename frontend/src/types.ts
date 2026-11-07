export type ConnState = 'connecting' | 'introspecting' | 'ready' | 'busy' | 'reconnecting' | 'closed'

export interface Status {
    id: string
    state: ConnState
    error?: string
    nextRetryMs?: number
    attempt?: number
    version?: string
}

export interface Column { name: string; type: string; notNull: boolean; default?: string; position: number; pk?: boolean }
export interface Index { name: string; def: string; unique: boolean; primary: boolean }
export interface Constraint { name: string; type: string; def: string }
export interface Table { name: string; kind: string; comment?: string; columns: Column[]; indexes: Index[]; constraints: Constraint[] }
export interface FunctionInfo { name: string; args: string }
export interface SchemaNode { name: string; tables: Table[]; functions: FunctionInfo[] }
export interface Schema { database: string; schemas: SchemaNode[] }

export interface ResultCol { name: string; type: string }
export interface Result {
    columns: ResultCol[]
    rows: any[][]
    truncated: boolean
    message?: string
    elapsedMs: number
}

export interface DuckTable {
    name: string
    rows: number
    columns: {name: string; type: string}[]
    sourceConn?: string
    sourceKind?: string
    sourceSql?: string
    createdAt?: string
}

export interface RedisKey { key: string; type: string; ttl: number }
export interface RedisPage { keys: RedisKey[]; cursor: string; dbSize: number }

export interface Pinned {
    id: string
    title: string
    sql: string
    result: Result
    at: number
}

export interface Tab {
    id: string
    title: string
    connId: string // connection id, or 'duck'
    kind: 'postgres' | 'redis' | 'duck'
    sql: string
    result?: Result
    error?: string
    running?: boolean
    queryId?: string
    pins?: Pinned[] // results the user pinned; they survive later runs
    ranSql?: string // the statement that produced `result`, used when saving
    autoRun?: boolean
}
