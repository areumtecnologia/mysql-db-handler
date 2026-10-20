// Áreum Tecnologia - Renan Moreira - renan.moreira@areum.com.br
const DataBase = require('./database');
let NodeCache;
try {
    NodeCache = require('node-cache');
} catch {
    NodeCache = class FallbackCache {
        constructor(options = {}) {
            this.map = new Map();
            this.defaultTTL = (options.stdTTL || 100) * 1000;
            const checkPeriod = (options.checkperiod || 120) * 1000;
            if (checkPeriod > 0) {
                this.timer = setInterval(() => this._evictExpired(), checkPeriod);
                if (this.timer.unref) this.timer.unref();
            }
        }
        _evictExpired() {
            const now = Date.now();
            for (const [k, entry] of this.map.entries()) {
                if (entry.expiry && now > entry.expiry) {
                    this.map.delete(k);
                }
            }
        }
        get(key) {
            const entry = this.map.get(key);
            if (!entry) return undefined;
            if (entry.expiry && Date.now() > entry.expiry) {
                this.map.delete(key);
                return undefined;
            }
            return entry.val;
        }
        set(key, val, ttlSeconds) {
            const ttlMs = (ttlSeconds !== undefined ? ttlSeconds * 1000 : this.defaultTTL);
            const expiry = ttlMs > 0 ? Date.now() + ttlMs : null;
            this.map.set(key, { val, expiry });
        }
        del(keys) {
            const arr = Array.isArray(keys) ? keys : [keys];
            for (const k of arr) this.map.delete(k);
        }
        flushAll() {
            this.map.clear();
        }
        close() {
            if (this.timer) clearInterval(this.timer);
        }
    };
}

function safeStringify(data) {
    if (data === undefined || data === null) return '';
    try {
        return JSON.stringify(data, (_, value) =>
            typeof value === 'bigint' ? value.toString() : value
        );
    } catch {
        return String(data);
    }
}

function extractTableFromSql(sql) {
    if (!sql || typeof sql !== 'string') return 'global';
    const match = sql.match(/(?:FROM|INTO|UPDATE)\s+`?([a-zA-Z0-9_.]+)`?/i);
    return match ? match[1].replace(/`/g, '').toLowerCase() : 'global';
}

class DataBaseCache extends DataBase {
    /**
     * @param {Object} [config] - Configuração da base de dados.
     * @param {Object} [cacheOptions] - Opções do NodeCache ou store customizado ({ stdTTL, checkperiod, store }).
     */
    constructor(config = {}, cacheOptions = { stdTTL: 100, checkperiod: 120 }) {
        super(config);
        this.stdTTL = cacheOptions.stdTTL || 100;
        // Permite injetar um adaptador externo (ex.: Redis) ou usa NodeCache local
        this.cache = cacheOptions.store || new NodeCache(cacheOptions);
        // Índice de chaves por tabela para invalidação cirúrgica
        this.tableIndex = new Map();
    }

    createPool() {
        return this.pool;
    }

    _registerTableKey(table, key) {
        const normalizedTable = (table || 'global').toLowerCase();
        if (!this.tableIndex.has(normalizedTable)) {
            this.tableIndex.set(normalizedTable, new Set());
        }
        this.tableIndex.get(normalizedTable).add(key);
    }

    async query(sql, params, isWrite = false, options = {}) {
        const inActiveTransaction = this.hasActiveTransaction();
        const tableTag = (options.table || extractTableFromSql(sql)).toLowerCase();

        if (isWrite) {
            const result = await super.query(sql, params, true, options);
            if (result && !result.error) {
                if (inActiveTransaction) {
                    // Se estiver em transação, limpa o cache da tabela apenas quando o commit for confirmado
                    this.onCommit(() => this.clearTableCache(tableTag));
                } else {
                    await this.clearTableCache(tableTag);
                }
            }
            return result;
        }

        if (inActiveTransaction) {
            return await super.query(sql, params, false, options);
        }

        const key = `query:${tableTag}:${sql}:${safeStringify(params)}`;
        const cachedResult = await this.cache.get(key);

        if (cachedResult !== undefined && cachedResult !== null) {
            return cachedResult;
        }

        const rows = await super.query(sql, params, false, options);
        if (rows && !rows.error) {
            const ttl = options.ttl !== undefined ? options.ttl : this.stdTTL;
            await this.cache.set(key, rows, ttl);
            this._registerTableKey(tableTag, key);
        }
        return rows;
    }

    async getTableSchema(table) {
        const inActiveTransaction = this.hasActiveTransaction();
        const normalizedTable = String(table).toLowerCase();
        const key = `schema:${normalizedTable}`;

        if (!inActiveTransaction) {
            const cachedResult = await this.cache.get(key);
            if (cachedResult !== undefined && cachedResult !== null) {
                return cachedResult;
            }
        }

        const rows = await super.getTableSchema(table);
        if (!inActiveTransaction && rows && !rows.error) {
            await this.cache.set(key, rows, this.stdTTL);
            this._registerTableKey(normalizedTable, key);
        }
        return rows;
    }

    /**
     * Invalida seletivamente apenas as queries associadas a uma tabela específica.
     */
    async clearTableCache(table) {
        if (!table) return this.clearCache();
        const normalizedTable = String(table).replace(/`/g, '').toLowerCase();
        const keys = this.tableIndex.get(normalizedTable);

        if (keys && keys.size > 0) {
            const keyArray = Array.from(keys);
            if (typeof this.cache.del === 'function') {
                await this.cache.del(keyArray);
            } else {
                for (const k of keyArray) {
                    if (typeof this.cache.delete === 'function') await this.cache.delete(k);
                }
            }
            this.tableIndex.delete(normalizedTable);
        }
    }

    async clearCache() {
        this.tableIndex.clear();
        if (typeof this.cache.flushAll === 'function') {
            await this.cache.flushAll();
        } else if (typeof this.cache.clear === 'function') {
            await this.cache.clear();
        }
    }

    async close() {
        if (this.cache && typeof this.cache.close === 'function') {
            await this.cache.close();
        }
        await super.close();
    }
}

module.exports = DataBaseCache;