export namespace conn {
	
	export class Config {
	    id: string;
	    name: string;
	    kind: string;
	    host: string;
	    port: number;
	    user: string;
	    password?: string;
	    database: string;
	    sslMode: string;
	    readOnly: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.password = source["password"];
	        this.database = source["database"];
	        this.sslMode = source["sslMode"];
	        this.readOnly = source["readOnly"];
	    }
	}
	export class Status {
	    id: string;
	    state: string;
	    error?: string;
	    nextRetryMs?: number;
	    attempt?: number;
	    version?: string;
	
	    static createFrom(source: any = {}) {
	        return new Status(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.state = source["state"];
	        this.error = source["error"];
	        this.nextRetryMs = source["nextRetryMs"];
	        this.attempt = source["attempt"];
	        this.version = source["version"];
	    }
	}
	export class TestResult {
	    ok: boolean;
	    message: string;
	    version?: string;
	    latencyMs: number;
	    reused: boolean;
	
	    static createFrom(source: any = {}) {
	        return new TestResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.message = source["message"];
	        this.version = source["version"];
	        this.latencyMs = source["latencyMs"];
	        this.reused = source["reused"];
	    }
	}

}

export namespace duck {
	
	export class Col {
	    name: string;
	    type: string;
	
	    static createFrom(source: any = {}) {
	        return new Col(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.type = source["type"];
	    }
	}
	export class TableInfo {
	    name: string;
	    rows: number;
	    columns: Col[];
	    sourceConn?: string;
	    sourceKind?: string;
	    sourceSql?: string;
	    createdAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new TableInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.rows = source["rows"];
	        this.columns = this.convertValues(source["columns"], Col);
	        this.sourceConn = source["sourceConn"];
	        this.sourceKind = source["sourceKind"];
	        this.sourceSql = source["sourceSql"];
	        this.createdAt = source["createdAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace main {
	
	export class ExportInfo {
	    path: string;
	    rows: number;
	
	    static createFrom(source: any = {}) {
	        return new ExportInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.rows = source["rows"];
	    }
	}
	export class McpInfo {
	    enabled: boolean;
	    running: boolean;
	    port: number;
	    url: string;
	    token: string;
	    error?: string;
	    command: string;
	    json: string;
	
	    static createFrom(source: any = {}) {
	        return new McpInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.enabled = source["enabled"];
	        this.running = source["running"];
	        this.port = source["port"];
	        this.url = source["url"];
	        this.token = source["token"];
	        this.error = source["error"];
	        this.command = source["command"];
	        this.json = source["json"];
	    }
	}
	export class RedisPage {
	    keys: redisx.Key[];
	    cursor: string;
	    dbSize: number;
	
	    static createFrom(source: any = {}) {
	        return new RedisPage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.keys = this.convertValues(source["keys"], redisx.Key);
	        this.cursor = source["cursor"];
	        this.dbSize = source["dbSize"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SaveInfo {
	    table: string;
	    rows: number;
	
	    static createFrom(source: any = {}) {
	        return new SaveInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.table = source["table"];
	        this.rows = source["rows"];
	    }
	}

}

export namespace pg {
	
	export class Column {
	    name: string;
	    type: string;
	    notNull: boolean;
	    default?: string;
	    position: number;
	    pk?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Column(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.type = source["type"];
	        this.notNull = source["notNull"];
	        this.default = source["default"];
	        this.position = source["position"];
	        this.pk = source["pk"];
	    }
	}
	export class Constraint {
	    name: string;
	    type: string;
	    def: string;
	
	    static createFrom(source: any = {}) {
	        return new Constraint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.type = source["type"];
	        this.def = source["def"];
	    }
	}
	export class Function {
	    name: string;
	    args: string;
	
	    static createFrom(source: any = {}) {
	        return new Function(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.args = source["args"];
	    }
	}
	export class Index {
	    name: string;
	    def: string;
	    unique: boolean;
	    primary: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Index(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.def = source["def"];
	        this.unique = source["unique"];
	        this.primary = source["primary"];
	    }
	}
	export class Table {
	    name: string;
	    kind: string;
	    comment?: string;
	    columns: Column[];
	    indexes: Index[];
	    constraints: Constraint[];
	
	    static createFrom(source: any = {}) {
	        return new Table(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.comment = source["comment"];
	        this.columns = this.convertValues(source["columns"], Column);
	        this.indexes = this.convertValues(source["indexes"], Index);
	        this.constraints = this.convertValues(source["constraints"], Constraint);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SchemaNode {
	    name: string;
	    tables: Table[];
	    functions: Function[];
	
	    static createFrom(source: any = {}) {
	        return new SchemaNode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.tables = this.convertValues(source["tables"], Table);
	        this.functions = this.convertValues(source["functions"], Function);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Schema {
	    database: string;
	    schemas: SchemaNode[];
	
	    static createFrom(source: any = {}) {
	        return new Schema(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.database = source["database"];
	        this.schemas = this.convertValues(source["schemas"], SchemaNode);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	

}

export namespace redisx {
	
	export class Key {
	    key: string;
	    type: string;
	    ttl: number;
	
	    static createFrom(source: any = {}) {
	        return new Key(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.type = source["type"];
	        this.ttl = source["ttl"];
	    }
	}

}

export namespace result {
	
	export class Col {
	    name: string;
	    type: string;
	
	    static createFrom(source: any = {}) {
	        return new Col(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.type = source["type"];
	    }
	}
	export class Result {
	    columns: Col[];
	    rows: any[][];
	    truncated: boolean;
	    message?: string;
	    elapsedMs: number;
	
	    static createFrom(source: any = {}) {
	        return new Result(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.columns = this.convertValues(source["columns"], Col);
	        this.rows = source["rows"];
	        this.truncated = source["truncated"];
	        this.message = source["message"];
	        this.elapsedMs = source["elapsedMs"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace store {
	
	export class Prefs {
	    theme: string;
	    fontFamily: string;
	    fontSize: number;
	    density: string;
	    wordWrap: boolean;
	    minimap: boolean;
	    lineNumbers: boolean;
	    tabSize: number;
	    autosave: boolean;
	    rowLimit: number;
	    timeoutSec: number;
	    confirmDestructive: boolean;
	    sidebarWidth: number;
	    keybindings: Record<string, string>;
	    recentFolders: string[];
	    lastFolder: string;
	
	    static createFrom(source: any = {}) {
	        return new Prefs(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.theme = source["theme"];
	        this.fontFamily = source["fontFamily"];
	        this.fontSize = source["fontSize"];
	        this.density = source["density"];
	        this.wordWrap = source["wordWrap"];
	        this.minimap = source["minimap"];
	        this.lineNumbers = source["lineNumbers"];
	        this.tabSize = source["tabSize"];
	        this.autosave = source["autosave"];
	        this.rowLimit = source["rowLimit"];
	        this.timeoutSec = source["timeoutSec"];
	        this.confirmDestructive = source["confirmDestructive"];
	        this.sidebarWidth = source["sidebarWidth"];
	        this.keybindings = source["keybindings"];
	        this.recentFolders = source["recentFolders"];
	        this.lastFolder = source["lastFolder"];
	    }
	}

}

export namespace workspace {
	
	export class Entry {
	    name: string;
	    path: string;
	    isDir: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Entry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	    }
	}

}

