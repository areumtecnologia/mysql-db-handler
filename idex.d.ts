import { Pool, PoolConnection, PoolOptions, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

export type IsolationLevel = 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export interface ExtendedDatabaseConfig extends PoolOptions {
    throwOnError?: boolean;
    usePreparedStatements?: boolean;
    slowQueryThreshold?: number;
    onSlowQuery?: (info: { sql: string; params: any; durationMs: number }) => void;
    logger?: Pick<Console, 'log' | 'warn' | 'error' | 'debug'>;
    maxRetries?: number;
    retryDelayMs?: number;
}

export interface TransactionOptions {
    isolationLevel?: IsolationLevel;
    retries?: number;
    retryDelayMs?: number;
}

export interface AutoTransactionOptions {
    methods?: string[];
    lazy?: boolean;
    isolationLevel?: IsolationLevel;
}

export interface CacheStoreAdapter {
    get(key: string): any | Promise<any>;
    set(key: string, val: any, ttl?: number): any | Promise<any>;
    del?(keys: string | string[]): any | Promise<any>;
    flushAll?(): any | Promise<any>;
    close?(): any | Promise<any>;
}

export interface CacheOptions {
    stdTTL?: number;
    checkperiod?: number;
    store?: CacheStoreAdapter;
}

export interface PaginateOptions {
    page?: number;
    limit?: number;
    where?: any;
    fields?: Array<string | { column: string; as: string } | { raw: string }>;
    orderBy?: string | string[];
    groupBy?: string | string[];
    having?: { sql: string; bindings?: any[] } | string;
}

export interface PaginatedResult<T = any> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export class DataBase {
    id: number;
    config: ExtendedDatabaseConfig;
    pool: Pool;

    constructor(config?: ExtendedDatabaseConfig);
    getPool(): Pool;
    getConnection(): Promise<PoolConnection>;
    getCurrentTransaction(): Record<string, any> | null;
    hasActiveTransaction(): boolean;
    onCommit(callback: () => any | Promise<any>): void;
    transaction<T>(callback: (tx: any) => Promise<T>, options?: TransactionOptions): Promise<T>;
    transactional<T extends (...args: any[]) => Promise<any>>(fn: T, options?: TransactionOptions): T;
    autoTransaction(options?: AutoTransactionOptions): (req: any, res: any, next: any) => void;
    query<T = any>(sql: string, params?: any, isWrite?: boolean, options?: { prepare?: boolean; table?: string; ttl?: number }): Promise<T>;
    execute<T = any>(sql: string, params?: any[], isWrite?: boolean, options?: { table?: string }): Promise<T>;
    getTableSchema(table: string): Promise<RowDataPacket[]>;
    close(): Promise<void>;
}

export class DataBaseCache extends DataBase {
    constructor(config?: ExtendedDatabaseConfig, cacheOptions?: CacheOptions);
    createPool(): Pool;
    clearTableCache(table: string): Promise<void>;
    clearCache(): Promise<void>;
}

export class DataBaseHandler<T = RowDataPacket> {
    db: DataBase;
    table: string;
    debug: boolean;
    expression: string;
    onError: ((err: Error) => void) | null;

    static raw(sql: string): { __isRawSql: true; sql: string };

    constructor(database: DataBase, table: string, expression?: string);
    withTransaction(txOrDb: any): DataBaseHandler<T>;
    getSchema(): Promise<RowDataPacket[]>;
    executeQuery(sql: string, params?: any, isWrite?: boolean, options?: Record<string, any>): Promise<any>;

    // Fluent Query Builder
    selectFields(fields: string | string[] | Array<string | { column: string; as: string } | { raw: string }>): DataBaseHandler<T>;
    where(columnOrObject: string | Record<string, any> | any[], operatorOrValue?: any, value?: any): DataBaseHandler<T>;
    orWhere(columnOrObject: string | Record<string, any>, operatorOrValue?: any, value?: any): DataBaseHandler<T>;
    groupBy(cols: string | string[]): DataBaseHandler<T>;
    having(sql: string, bindings?: any[]): DataBaseHandler<T>;
    orderBy(column: string, dir?: 'ASC' | 'DESC'): DataBaseHandler<T>;
    limit(count: number): DataBaseHandler<T>;
    offset(count: number): DataBaseHandler<T>;
    get(): Promise<T[]>;
    first(): Promise<T | null>;
    count(column?: string): Promise<number>;

    // Core Operations
    paginate(options?: PaginateOptions): Promise<PaginatedResult<T>>;
    selectToDatatable(rawDtQuery: Record<string, any>, strictCondition?: any[]): Promise<{
        draw: number;
        recordsTotal: number;
        recordsFiltered: number;
        data: T[];
        error?: string;
    }>;
    selectBy(params?: Record<string, any>): Promise<T[]>;
    select(params?: any[], clauses?: {
        FIELDS?: any[];
        GROUPBY?: string | string[];
        HAVING?: string | { sql: string; bindings?: any[] };
        ORDERBY?: string | string[];
        DESC?: boolean;
        LIMIT?: number;
        OFFSET?: number;
    }): Promise<T[]>;
    insert(params: Record<string, any>): Promise<ResultSetHeader>;
    insertMany(rowsArray: Array<Record<string, any>>): Promise<ResultSetHeader>;
    upsert(data: Record<string, any>, updateColumns?: string[]): Promise<ResultSetHeader>;
    update(params: { set: Record<string, any>; where: any }, options?: { useRegex?: boolean }): Promise<ResultSetHeader>;
    delete(conditions: Record<string, any> | any[]): Promise<ResultSetHeader | undefined>;
}