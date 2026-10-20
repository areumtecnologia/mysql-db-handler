const stream = require('node:stream');

const ALLOWED_OPERATORS = new Set([
    '=', '!=', '<>', '>', '>=', '<', '<=',
    'LIKE', 'NOT LIKE', 'IN', 'NOT IN',
    'REGEXP', 'NOT REGEXP', 'IS', 'IS NOT', 'BETWEEN', 'NOT BETWEEN'
]);

function sanitizeOperator(op, defaultOp = '=') {
    if (!op) return defaultOp;
    const upper = String(op).toUpperCase().trim();
    return ALLOWED_OPERATORS.has(upper) ? upper : defaultOp;
}

function sanitizeIdentifier(name) {
    if (!name || typeof name !== 'string') return '';
    return name.replace(/`/g, '').trim();
}

function safeTable(tableName) {
    if (!tableName || typeof tableName !== 'string') return '';
    return tableName.split('.').map(part => `\`${sanitizeIdentifier(part)}\``).join('.');
}

function safeTableWithAlias(tableName) {
    if (!tableName || typeof tableName !== 'string') return '';
    const parts = tableName.trim().split(/\s+(?:AS\s+)?/i);
    if (parts.length === 2) {
        return `${safeTable(parts[0])} AS \`${sanitizeIdentifier(parts[1])}\``;
    }
    return safeTable(tableName);
}

function safeColumn(columnName) {
    if (!columnName || typeof columnName !== 'string') return '';
    const trimmed = columnName.trim();
    if (trimmed === '*') return '*';
    return trimmed.split('.').map(part => part === '*' ? '*' : `\`${sanitizeIdentifier(part)}\``).join('.');
}

/**
 * Sanitiza listas de colunas para GROUP BY ou ORDER BY (suportando direção ASC/DESC em ORDER BY).
 */
function sanitizeClauseList(clause, allowDirection = false) {
    if (!clause) return '';
    const items = Array.isArray(clause) ? clause : String(clause).split(',');
    const sanitized = [];

    for (const rawItem of items) {
        const item = String(rawItem).trim();
        if (!item) continue;

        if (allowDirection) {
            const parts = item.split(/\s+/);
            const col = safeColumn(parts[0]);
            const dir = parts[1] && ['ASC', 'DESC'].includes(parts[1].toUpperCase()) ? ` ${parts[1].toUpperCase()}` : '';
            if (col) sanitized.push(`${col}${dir}`);
        } else {
            const col = safeColumn(item);
            if (col) sanitized.push(col);
        }
    }
    return sanitized.join(', ');
}

/**
 * Permite expressões SQL seguras quando encapsuladas explicitamente.
 */
function raw(sql) {
    return { __isRawSql: true, sql: String(sql) };
}

class DatabaseHandler {
    constructor(database, table, expressionOrOptions = '') {
        this.db = database;
        this.table = table;
        this.debug = false;
        this.onError = null;

        if (typeof expressionOrOptions === 'string') {
            this.expression = expressionOrOptions;
            this.options = {};
        } else if (expressionOrOptions && typeof expressionOrOptions === 'object') {
            this.expression = expressionOrOptions.expression || '';
            this.options = { ...expressionOrOptions };
        } else {
            this.expression = '';
            this.options = {};
        }

        this.softDelete = this.options.softDelete || false;
        this.timestamps = this.options.timestamps || false;
        this.hiddenFields = Array.isArray(this.options.hiddenFields) ? [...this.options.hiddenFields] : [];
        this.autoStripUnknown = Boolean(this.options.autoStripUnknown);

        this._hooks = {
            beforeInsert: [],
            afterInsert: [],
            beforeUpdate: [],
            afterUpdate: [],
            beforeDelete: [],
            afterDelete: []
        };

        // Estado interno para o Query Builder Fluente
        this._resetBuilder();
    }

    static raw(sql) {
        return raw(sql);
    }

    static hasMany(handler, foreignKey, localKey = 'id') {
        return { type: 'hasMany', handler, foreignKey, localKey };
    }

    static belongsTo(handler, foreignKey, localKey = 'id') {
        return { type: 'belongsTo', handler, foreignKey, localKey };
    }

    static hasOne(handler, foreignKey, localKey = 'id') {
        return { type: 'hasOne', handler, foreignKey, localKey };
    }

    _resetBuilder() {
        this._qb = {
            fields: [],
            joins: [],
            where: [],
            groupBy: [],
            having: null,
            orderBy: [],
            limit: undefined,
            offset: undefined,
            relations: [],
            withTrashed: false,
            onlyTrashed: false
        };
    }

    _cloneWithBuilder(modifierFn) {
        const clone = new DatabaseHandler(this.db, this.table, {
            expression: this.expression,
            softDelete: this.softDelete,
            timestamps: this.timestamps,
            hiddenFields: this.hiddenFields,
            autoStripUnknown: this.autoStripUnknown
        });
        clone.debug = this.debug;
        clone.onError = this.onError;
        clone._hooks = {
            beforeInsert: [...this._hooks.beforeInsert],
            afterInsert: [...this._hooks.afterInsert],
            beforeUpdate: [...this._hooks.beforeUpdate],
            afterUpdate: [...this._hooks.afterUpdate],
            beforeDelete: [...this._hooks.beforeDelete],
            afterDelete: [...this._hooks.afterDelete]
        };
        clone._qb = {
            fields: [...this._qb.fields],
            joins: [...this._qb.joins],
            where: [...this._qb.where],
            groupBy: [...this._qb.groupBy],
            having: this._qb.having ? { ...this._qb.having } : null,
            orderBy: [...this._qb.orderBy],
            limit: this._qb.limit,
            offset: this._qb.offset,
            relations: [...this._qb.relations],
            withTrashed: this._qb.withTrashed,
            onlyTrashed: this._qb.onlyTrashed
        };
        if (typeof modifierFn === 'function') {
            modifierFn(clone._qb);
        }
        return clone;
    }

    _safeTable() {
        return safeTable(this.table);
    }

    _formatExpression() {
        if (!this.expression || typeof this.expression !== 'string') return '';
        const cleaned = this.expression.trim().replace(/^,\s*/, '');
        return cleaned ? `, ${cleaned}` : '';
    }

    _buildSelectColumns(customFields = []) {
        const expr = this._formatExpression();
        if (!customFields || customFields.length === 0) {
            return `*${expr}`;
        }

        const formatted = customFields.map(field => {
            if (field && typeof field === 'object') {
                if (field.__isRawSql) return field.sql;
                if (field.raw) return String(field.raw);
                if (field.column && field.as) {
                    return `${safeColumn(field.column)} AS \`${sanitizeIdentifier(field.as)}\``;
                }
            }
            return safeColumn(String(field));
        }).filter(Boolean);

        const base = formatted.length > 0 ? formatted.join(', ') : '*';
        return `${base}${expr}`;
    }

    async executeQuery(sql, params, isWrite = false, options = {}) {
        if (this.debug) {
            console.debug('[SQL Debug]:', sql, params);
        }
        return await this.db.query(sql, params, isWrite, { ...options, table: this.table });
    }

    withTransaction(txOrDb) {
        const executor = (txOrDb && txOrDb.db) ? txOrDb.db : txOrDb;
        const handler = new DatabaseHandler(executor, this.table, {
            expression: this.expression,
            softDelete: this.softDelete,
            timestamps: this.timestamps,
            hiddenFields: this.hiddenFields,
            autoStripUnknown: this.autoStripUnknown
        });
        handler.debug = this.debug;
        handler.onError = this.onError;
        handler._hooks = { ...this._hooks };
        return handler;
    }

    async getSchema() {
        return await this.db.getTableSchema(this.table);
    }

    // =========================================================================
    // HOOKS DE CICLO DE VIDA (Life-cycle Hooks)
    // =========================================================================

    beforeInsert(fn) {
        if (typeof fn === 'function') this._hooks.beforeInsert.push(fn);
        return this;
    }

    afterInsert(fn) {
        if (typeof fn === 'function') this._hooks.afterInsert.push(fn);
        return this;
    }

    beforeUpdate(fn) {
        if (typeof fn === 'function') this._hooks.beforeUpdate.push(fn);
        return this;
    }

    afterUpdate(fn) {
        if (typeof fn === 'function') this._hooks.afterUpdate.push(fn);
        return this;
    }

    beforeDelete(fn) {
        if (typeof fn === 'function') this._hooks.beforeDelete.push(fn);
        return this;
    }

    afterDelete(fn) {
        if (typeof fn === 'function') this._hooks.afterDelete.push(fn);
        return this;
    }

    // =========================================================================
    // SOFT DELETES & ESCOPO TRASHED
    // =========================================================================

    _getSoftDeleteColumn() {
        if (!this.softDelete) return null;
        return typeof this.softDelete === 'string' ? this.softDelete : 'deletado_em';
    }

    withTrashed() {
        return this._cloneWithBuilder(qb => {
            qb.withTrashed = true;
            qb.onlyTrashed = false;
        });
    }

    onlyTrashed() {
        return this._cloneWithBuilder(qb => {
            qb.withTrashed = false;
            qb.onlyTrashed = true;
        });
    }

    // =========================================================================
    // QUERY BUILDER FLUENTE (Imutável por encadeamento)
    // =========================================================================

    selectFields(fields) {
        const list = Array.isArray(fields) ? fields : [fields];
        return this._cloneWithBuilder(qb => {
            qb.fields.push(...list);
        });
    }

    // Joins Fluentes
    join(table, first, operator, second) {
        return this._cloneWithBuilder(qb => {
            qb.joins.push({ type: 'INNER JOIN', table, first, operator, second });
        });
    }

    innerJoin(table, first, operator, second) {
        return this.join(table, first, operator, second);
    }

    leftJoin(table, first, operator, second) {
        return this._cloneWithBuilder(qb => {
            qb.joins.push({ type: 'LEFT JOIN', table, first, operator, second });
        });
    }

    rightJoin(table, first, operator, second) {
        return this._cloneWithBuilder(qb => {
            qb.joins.push({ type: 'RIGHT JOIN', table, first, operator, second });
        });
    }

    _buildJoinClauses(joins) {
        if (!Array.isArray(joins) || joins.length === 0) return '';
        const clauses = joins.map(j => {
            const tableSql = safeTableWithAlias(j.table);
            const firstCol = safeColumn(j.first);
            const op = sanitizeOperator(j.operator, '=');
            const secondCol = safeColumn(j.second);
            return `${j.type} ${tableSql} ON ${firstCol} ${op} ${secondCol}`;
        });
        return ` ${clauses.join(' ')}`;
    }

    // Eager Loading (.with)
    with(relationName, relationOrHandler) {
        return this._cloneWithBuilder(qb => {
            let config;
            if (relationOrHandler instanceof DatabaseHandler) {
                config = {
                    name: relationName,
                    type: 'hasMany',
                    handler: relationOrHandler,
                    foreignKey: `${this.table.replace(/s$/, '')}_id`,
                    localKey: 'id'
                };
            } else if (typeof relationOrHandler === 'object' && relationOrHandler !== null) {
                config = {
                    name: relationName,
                    type: relationOrHandler.type || relationOrHandler.relationType || 'hasMany',
                    handler: relationOrHandler.handler,
                    foreignKey: relationOrHandler.foreignKey,
                    localKey: relationOrHandler.localKey || 'id',
                    query: relationOrHandler.query
                };
            } else {
                throw new Error(`Definição de relação inválida para "${relationName}"`);
            }
            qb.relations.push(config);
        });
    }

    async _applyEagerLoading(rows, relations) {
        if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(relations) || relations.length === 0) {
            return rows;
        }

        for (const rel of relations) {
            const { name, type, handler, foreignKey, localKey, query } = rel;
            if (!handler || !foreignKey || !localKey) continue;

            if (type === 'hasMany' || type === 'hasOne') {
                const parentKeys = [...new Set(rows.map(r => r[localKey]).filter(k => k !== undefined && k !== null))];
                if (parentKeys.length === 0) {
                    rows.forEach(r => {
                        r[name] = type === 'hasMany' ? [] : null;
                    });
                    continue;
                }

                const hadHiddenFk = Array.isArray(handler.hiddenFields) && handler.hiddenFields.includes(foreignKey);
                let effectiveHandler = handler;
                if (hadHiddenFk) {
                    effectiveHandler = handler._cloneWithBuilder();
                    effectiveHandler.hiddenFields = handler.hiddenFields.filter(f => f !== foreignKey);
                }

                let q = effectiveHandler.where({ [foreignKey]: parentKeys });
                if (typeof query === 'function') {
                    q = query(q) || q;
                }
                const childRecords = await q.get();
                const safeChildren = Array.isArray(childRecords) ? childRecords : [];

                const grouped = new Map();
                for (const child of safeChildren) {
                    const fkVal = child[foreignKey];
                    if (!grouped.has(fkVal)) {
                        grouped.set(fkVal, []);
                    }
                    grouped.get(fkVal).push(child);
                }

                for (const row of rows) {
                    const lkVal = row[localKey];
                    const matched = grouped.get(lkVal) || [];
                    row[name] = type === 'hasMany' ? matched : (matched[0] || null);
                }

                if (hadHiddenFk) {
                    for (const child of safeChildren) {
                        delete child[foreignKey];
                    }
                }
            } else if (type === 'belongsTo') {
                const fkValues = [...new Set(rows.map(r => r[foreignKey]).filter(k => k !== undefined && k !== null))];
                if (fkValues.length === 0) {
                    rows.forEach(r => {
                        r[name] = null;
                    });
                    continue;
                }

                const hadHiddenLk = Array.isArray(handler.hiddenFields) && handler.hiddenFields.includes(localKey);
                let effectiveHandler = handler;
                if (hadHiddenLk) {
                    effectiveHandler = handler._cloneWithBuilder();
                    effectiveHandler.hiddenFields = handler.hiddenFields.filter(f => f !== localKey);
                }

                let q = effectiveHandler.where({ [localKey]: fkValues });
                if (typeof query === 'function') {
                    q = query(q) || q;
                }
                const targetRecords = await q.get();
                const safeTargets = Array.isArray(targetRecords) ? targetRecords : [];

                const map = new Map();
                for (const target of safeTargets) {
                    map.set(target[localKey], target);
                }

                for (const row of rows) {
                    const fkVal = row[foreignKey];
                    row[name] = map.get(fkVal) || null;
                }

                if (hadHiddenLk) {
                    for (const target of safeTargets) {
                        delete target[localKey];
                    }
                }
            }
        }

        return rows;
    }

    where(condition, operatorOrValue, maybeValue) {
        return this._cloneWithBuilder(qb => {
            if (qb.where.length > 0) {
                qb.where.push('AND');
            }
            if (typeof condition === 'string') {
                if (arguments.length === 2) {
                    qb.where.push({ [condition]: operatorOrValue, operator: '=' });
                } else {
                    qb.where.push({ [condition]: maybeValue, operator: operatorOrValue });
                }
            } else if (Array.isArray(condition)) {
                qb.where.push(...condition);
            } else if (typeof condition === 'object' && condition !== null) {
                for (const [k, v] of Object.entries(condition)) {
                    if (qb.where.length > 0 && qb.where[qb.where.length - 1] !== 'AND' && qb.where[qb.where.length - 1] !== 'OR') {
                        qb.where.push('AND');
                    }
                    qb.where.push({ [k]: v, operator: '=' });
                }
            }
        });
    }

    orWhere(condition, operatorOrValue, maybeValue) {
        return this._cloneWithBuilder(qb => {
            if (qb.where.length > 0) {
                qb.where.push('OR');
            }
            if (typeof condition === 'string') {
                if (arguments.length === 2) {
                    qb.where.push({ [condition]: operatorOrValue, operator: '=' });
                } else {
                    qb.where.push({ [condition]: maybeValue, operator: operatorOrValue });
                }
            } else if (typeof condition === 'object' && condition !== null) {
                qb.where.push(condition);
            }
        });
    }

    groupBy(cols) {
        const list = Array.isArray(cols) ? cols : [cols];
        return this._cloneWithBuilder(qb => qb.groupBy.push(...list));
    }

    having(sql, bindings = []) {
        return this._cloneWithBuilder(qb => {
            qb.having = { sql, bindings: Array.isArray(bindings) ? bindings : [bindings] };
        });
    }

    orderBy(column, dir = 'ASC') {
        return this._cloneWithBuilder(qb => {
            const safeDir = String(dir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
            qb.orderBy.push(`${column} ${safeDir}`);
        });
    }

    limit(count) {
        return this._cloneWithBuilder(qb => {
            qb.limit = parseInt(count, 10);
        });
    }

    offset(count) {
        return this._cloneWithBuilder(qb => {
            qb.offset = parseInt(count, 10);
        });
    }

    async get() {
        const rows = await this.select(this._qb.where, {
            FIELDS: this._qb.fields,
            JOINS: this._qb.joins,
            GROUPBY: this._qb.groupBy.length ? this._qb.groupBy : undefined,
            HAVING: this._qb.having || undefined,
            ORDERBY: this._qb.orderBy.length ? this._qb.orderBy : undefined,
            LIMIT: this._qb.limit,
            OFFSET: this._qb.offset,
            WITH_TRASHED: this._qb.withTrashed,
            ONLY_TRASHED: this._qb.onlyTrashed
        });
        if (rows && rows.error) return rows;
        if (Array.isArray(rows) && this._qb.relations.length > 0) {
            await this._applyEagerLoading(rows, this._qb.relations);
        }
        return this._maskHiddenFields(rows);
    }

    async first() {
        const rows = await this.limit(1).get();
        if (rows && rows.error) return rows;
        return Array.isArray(rows) ? (rows[0] || null) : null;
    }

    async count(column = '*') {
        const softCol = this._getSoftDeleteColumn();
        const whereConditions = [...this._qb.where];
        if (softCol && !this._qb.withTrashed) {
            if (whereConditions.length > 0) whereConditions.push('AND');
            if (this._qb.onlyTrashed) {
                whereConditions.push({ [softCol]: null, operator: 'IS NOT' });
            } else {
                whereConditions.push({ [softCol]: null, operator: 'IS' });
            }
        }

        const { sql: whereSql, bindings } = this._buildWhereClause(whereConditions);
        const whereClause = whereSql ? ` WHERE ${whereSql}` : '';
        const joinClause = this._buildJoinClauses(this._qb.joins);
        const colSql = column === '*' ? '*' : safeColumn(column);
        const sql = `SELECT COUNT(${colSql}) AS total FROM ${this._safeTable()}${joinClause}${whereClause}`;
        const result = await this.executeQuery(sql, bindings);
        if (result && result.error) return result;
        return Number(result?.[0]?.total || 0);
    }

    // Keyset Pagination (.cursorPaginate)
    async cursorPaginate(options = {}) {
        const cursorCol = options.cursorColumn || 'id';
        const limit = Math.max(1, parseInt(options.limit, 10) || 20);
        const direction = String(options.direction || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        const after = options.after !== undefined ? options.after : null;
        const before = options.before !== undefined ? options.before : null;

        let qb = this._cloneWithBuilder();
        let isReverse = false;

        if (after !== null) {
            const op = direction === 'ASC' ? '>' : '<';
            qb = qb.where(cursorCol, op, after).orderBy(cursorCol, direction);
        } else if (before !== null) {
            isReverse = true;
            const op = direction === 'ASC' ? '<' : '>';
            const revDir = direction === 'ASC' ? 'DESC' : 'ASC';
            qb = qb.where(cursorCol, op, before).orderBy(cursorCol, revDir);
        } else {
            qb = qb.orderBy(cursorCol, direction);
        }

        qb = qb.limit(limit + 1);
        const rows = await qb.get();

        if (rows && rows.error) return rows;

        const safeRows = Array.isArray(rows) ? rows : [];
        const hasMore = safeRows.length > limit;
        if (hasMore) {
            safeRows.pop();
        }

        if (isReverse) {
            safeRows.reverse();
        }

        const nextCursor = safeRows.length > 0 ? safeRows[safeRows.length - 1][cursorCol] : null;
        const prevCursor = safeRows.length > 0 ? safeRows[0][cursorCol] : null;

        return {
            data: safeRows,
            nextCursor,
            prevCursor,
            hasMore,
            limit
        };
    }

    // Streaming & Async Generator (.cursor & .stream)
    async *cursor({ batchSize = 1000, cursorColumn = 'id' } = {}) {
        let lastId = null;
        const batch = Math.max(1, parseInt(batchSize, 10) || 1000);

        while (true) {
            let q = this._cloneWithBuilder();
            if (lastId !== null) {
                q = q.where(cursorColumn, '>', lastId);
            }
            q = q.orderBy(cursorColumn, 'ASC').limit(batch);
            const rows = await q.get();

            if (!Array.isArray(rows) || rows.length === 0) {
                break;
            }

            for (const row of rows) {
                yield row;
                lastId = row[cursorColumn];
            }

            if (rows.length < batch) {
                break;
            }
        }
    }

    stream(options = {}) {
        return stream.Readable.from(this.cursor(options));
    }

    // =========================================================================
    // MÉTODOS CORE E UTILITÁRIOS INTERNOS
    // =========================================================================

    _hydrateObject(flatObject) {
        if (!flatObject || typeof flatObject !== 'object') return {};
        const result = {};

        for (const key of Object.keys(flatObject)) {
            if (!key.includes('[')) {
                if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
                    result[key] = flatObject[key];
                }
                continue;
            }

            const keys = key.match(/[^[\]']+/g);
            if (!keys || keys.some(k => k === '__proto__' || k === 'constructor' || k === 'prototype')) {
                continue;
            }

            let current = result;
            for (let i = 0; i < keys.length - 1; i++) {
                const k = keys[i];
                const nextKey = keys[i + 1];
                if (current[k] === undefined) {
                    current[k] = !isNaN(nextKey) ? [] : {};
                }
                current = current[k];
            }
            current[keys[keys.length - 1]] = flatObject[key];
        }
        return result;
    }

    _maskHiddenFields(rows) {
        if (!this.hiddenFields || this.hiddenFields.length === 0 || !rows) {
            return rows;
        }

        const hiddenSet = new Set(this.hiddenFields);
        const maskRow = (row) => {
            if (!row || typeof row !== 'object') return row;
            for (const h of hiddenSet) {
                delete row[h];
            }
            return row;
        };

        if (Array.isArray(rows)) {
            rows.forEach(maskRow);
            return rows;
        }
        return maskRow(rows);
    }

    async _stripUnknownFields(data) {
        if (!this.autoStripUnknown || !data || typeof data !== 'object') {
            return data;
        }

        const schema = await this.getSchema();
        if (!Array.isArray(schema) || schema.length === 0) {
            return data;
        }

        const validCols = new Set(
            schema.map(col => (col.COLUMN_NAME || col.column_name || '').toLowerCase()).filter(Boolean)
        );

        if (validCols.size === 0) return data;

        if (Array.isArray(data)) {
            return data.map(item => this._stripSingleObject(item, validCols));
        }
        return this._stripSingleObject(data, validCols);
    }

    _stripSingleObject(obj, validCols) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
        const cleaned = {};
        for (const [key, val] of Object.entries(obj)) {
            if (validCols.has(key.toLowerCase())) {
                cleaned[key] = val;
            }
        }
        return cleaned;
    }

    _applyTimestampsOnInsert(data) {
        if (!this.timestamps || !data || typeof data !== 'object') return data;
        const now = new Date();
        const createdCol = typeof this.timestamps === 'object' && this.timestamps.createdAt ? this.timestamps.createdAt : 'criado_em';
        const updatedCol = typeof this.timestamps === 'object' && this.timestamps.updatedAt ? this.timestamps.updatedAt : 'atualizado_em';

        if (Array.isArray(data)) {
            data.forEach(item => {
                if (item && typeof item === 'object') {
                    if (item[createdCol] === undefined) item[createdCol] = now;
                    if (item[updatedCol] === undefined) item[updatedCol] = now;
                }
            });
            return data;
        }

        if (data[createdCol] === undefined) data[createdCol] = now;
        if (data[updatedCol] === undefined) data[updatedCol] = now;
        return data;
    }

    _applyTimestampsOnUpdate(setData) {
        if (!this.timestamps || !setData || typeof setData !== 'object') return setData;
        const now = new Date();
        const updatedCol = typeof this.timestamps === 'object' && this.timestamps.updatedAt ? this.timestamps.updatedAt : 'atualizado_em';
        if (setData[updatedCol] === undefined) {
            setData[updatedCol] = now;
        }
        return setData;
    }

    _buildWhereClause(where, useRegex = false, wrapInParens = false) {
        if (!where) {
            return { sql: '', bindings: [] };
        }

        const conditions = [];
        const bindings = [];
        const defaultOp = useRegex ? 'REGEXP' : '=';

        if (Array.isArray(where)) {
            if (where.length === 0) return { sql: '', bindings: [] };

            for (const param of where) {
                if (typeof param === 'string') {
                    const upper = param.toUpperCase().trim();
                    if (upper === 'AND' || upper === 'OR') {
                        conditions.push(upper);
                    }
                } else if (typeof param === 'object' && param !== null && !Array.isArray(param)) {
                    const keys = Object.keys(param);
                    const colKey = keys.find(k => k.toLowerCase() !== 'operator');
                    if (!colKey) continue;

                    const colSql = safeColumn(colKey);
                    const value = param[colKey];
                    const opKey = keys.find(k => k.toLowerCase() === 'operator');
                    let op = sanitizeOperator(opKey ? param[opKey] : undefined, defaultOp);

                    if (value === null) {
                        if (op === '=' || op === 'IS') {
                            conditions.push(`${colSql} IS NULL`);
                        } else {
                            conditions.push(`${colSql} IS NOT NULL`);
                        }
                        continue;
                    }

                    if ((op === 'BETWEEN' || op === 'NOT BETWEEN') && Array.isArray(value) && value.length === 2) {
                        conditions.push(`${colSql} ${op} ? AND ?`);
                        bindings.push(value[0], value[1]);
                        continue;
                    }

                    if (Array.isArray(value)) {
                        if (op === '=') op = 'IN';
                        else if (op === '!=' || op === '<>') op = 'NOT IN';

                        if (op === 'IN' || op === 'NOT IN') {
                            if (value.length === 0) {
                                conditions.push(op === 'IN' ? '1 = 0' : '1 = 1');
                            } else {
                                const placeholders = value.map(() => '?').join(', ');
                                conditions.push(`${colSql} ${op} (${placeholders})`);
                                bindings.push(...value);
                            }
                            continue;
                        }
                    }

                    conditions.push(`${colSql} ${op} ?`);
                    bindings.push(value);
                }
            }

            if (conditions.length === 0) return { sql: '', bindings: [] };
            const joined = conditions.join(' ');
            return { sql: wrapInParens ? `(${joined})` : joined, bindings };

        } else if (typeof where === 'object') {
            for (const [key, value] of Object.entries(where)) {
                const colSql = safeColumn(key);
                if (value === null) {
                    conditions.push(`${colSql} IS NULL`);
                } else if (Array.isArray(value)) {
                    if (value.length === 0) {
                        conditions.push('1 = 0');
                    } else {
                        const placeholders = value.map(() => '?').join(', ');
                        conditions.push(`${colSql} IN (${placeholders})`);
                        bindings.push(...value);
                    }
                } else {
                    conditions.push(`${colSql} ${defaultOp} ?`);
                    bindings.push(value);
                }
            }
            const joined = conditions.join(' AND ');
            return { sql: wrapInParens && joined ? `(${joined})` : joined, bindings };
        }

        return { sql: '', bindings: [] };
    }

    _parseStrictCondition(strictCondition) {
        return this._buildWhereClause(strictCondition, false, true);
    }

    async paginate(options = {}) {
        const page = Math.max(1, parseInt(options.page, 10) || 1);
        const limit = Math.max(1, parseInt(options.limit, 10) || 20);
        const offset = (page - 1) * limit;

        const targetWhere = options.where !== undefined ? options.where : this._qb.where;
        const softCol = this._getSoftDeleteColumn();
        const whereConditions = Array.isArray(targetWhere) ? [...targetWhere] : (typeof targetWhere === 'object' && targetWhere !== null ? [targetWhere] : []);

        if (softCol && !this._qb.withTrashed) {
            if (whereConditions.length > 0) whereConditions.push('AND');
            if (this._qb.onlyTrashed) {
                whereConditions.push({ [softCol]: null, operator: 'IS NOT' });
            } else {
                whereConditions.push({ [softCol]: null, operator: 'IS' });
            }
        }

        const { sql: whereSql, bindings } = this._buildWhereClause(whereConditions);
        const whereClause = whereSql ? ` WHERE ${whereSql}` : '';
        const joinClause = this._buildJoinClauses(this._qb.joins);
        const table = this._safeTable();

        const countSql = `SELECT COUNT(*) AS total FROM ${table}${joinClause}${whereClause}`;
        const selectClauses = {
            FIELDS: options.fields || this._qb.fields,
            JOINS: this._qb.joins,
            GROUPBY: options.groupBy || (this._qb.groupBy.length ? this._qb.groupBy : undefined),
            HAVING: options.having || this._qb.having || undefined,
            ORDERBY: options.orderBy || (this._qb.orderBy.length ? this._qb.orderBy : undefined),
            DESC: options.desc,
            WITH_TRASHED: true, // Já aplicado em whereConditions
            ...options.clauses,
            LIMIT: limit,
            OFFSET: offset
        };

        const inTx = typeof this.db.hasActiveTransaction === 'function' && this.db.hasActiveTransaction();
        let countRes, dataRes;

        if (!inTx) {
            [countRes, dataRes] = await Promise.all([
                this.executeQuery(countSql, bindings),
                this.select(whereConditions, selectClauses)
            ]);
        } else {
            countRes = await this.executeQuery(countSql, bindings);
            dataRes = await this.select(whereConditions, selectClauses);
        }

        if (countRes && countRes.error) return countRes;
        if (dataRes && dataRes.error) return dataRes;

        const total = Number(countRes?.[0]?.total || 0);
        const totalPages = Math.ceil(total / limit) || 1;
        let data = Array.isArray(dataRes) ? dataRes : [];

        if (data.length > 0 && this._qb.relations.length > 0) {
            await this._applyEagerLoading(data, this._qb.relations);
        }

        return {
            data: this._maskHiddenFields(data),
            total,
            page,
            limit,
            totalPages
        };
    }

    async selectToDatatable(rawDtQuery, strictCondition = []) {
        const isTrue = (val) => val === true || val === 'true';
        const dtQuery = this._hydrateObject(rawDtQuery);
        const { draw, start, length, search, order, columns } = dtQuery;
        const table = this._safeTable();
        const parsedDraw = parseInt(draw, 10) || 0;

        try {
            const finalStrict = Array.isArray(strictCondition) ? [...strictCondition] : [strictCondition];
            const softCol = this._getSoftDeleteColumn();
            if (softCol && !this._qb.withTrashed) {
                if (finalStrict.length > 0) finalStrict.push('AND');
                if (this._qb.onlyTrashed) {
                    finalStrict.push({ [softCol]: null, operator: 'IS NOT' });
                } else {
                    finalStrict.push({ [softCol]: null, operator: 'IS' });
                }
            }

            const baseWhere = this._parseStrictCondition(finalStrict);
            const finalBindings = [...baseWhere.bindings];
            const finalWhereClauses = baseWhere.sql ? [baseWhere.sql] : [];

            const dtSearchClauses = [];
            if (Array.isArray(columns)) {
                if (search && search.value !== '' && search.value !== undefined && search.value !== null) {
                    const searchableCols = columns.filter(c => c && c.data && isTrue(c.searchable));
                    if (searchableCols.length > 0) {
                        const isRegex = isTrue(search.regex);
                        const operator = isRegex ? 'REGEXP' : 'LIKE';
                        const term = isRegex ? `${search.value}` : `%${search.value}%`;

                        const orClauses = searchableCols.map(c => `${safeColumn(c.data)} ${operator} ?`);
                        dtSearchClauses.push(`(${orClauses.join(' OR ')})`);
                        for (let i = 0; i < searchableCols.length; i++) {
                            finalBindings.push(term);
                        }
                    }
                }

                for (const col of columns) {
                    if (col && col.data && isTrue(col.searchable) && col.search && col.search.value !== '' && col.search.value !== undefined && col.search.value !== null) {
                        const isRegex = isTrue(col.search.regex);
                        const operator = isRegex ? 'REGEXP' : 'LIKE';
                        const term = isRegex ? `${col.search.value}` : `%${col.search.value}%`;

                        dtSearchClauses.push(`${safeColumn(col.data)} ${operator} ?`);
                        finalBindings.push(term);
                    }
                }
            }

            if (dtSearchClauses.length > 0) {
                finalWhereClauses.push(dtSearchClauses.join(' AND '));
            }

            const hasDtSearch = dtSearchClauses.length > 0;
            const whereSql = finalWhereClauses.length > 0 ? `WHERE ${finalWhereClauses.join(' AND ')}` : '';
            const baseWhereSql = baseWhere.sql ? `WHERE ${baseWhere.sql}` : '';
            const joinClause = this._buildJoinClauses(this._qb.joins);

            let orderSql = '';
            if (order && Array.isArray(columns)) {
                const orderArray = Array.isArray(order) ? order : Object.values(order);
                const orderParts = [];
                for (const ord of orderArray) {
                    if (!ord || ord.column === undefined) continue;
                    const colDef = columns[parseInt(ord.column, 10)];
                    if (colDef && isTrue(colDef.orderable) && colDef.data) {
                        const orderDir = ord.dir && String(ord.dir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
                        orderParts.push(`${safeColumn(colDef.data)} ${orderDir}`);
                    }
                }
                if (orderParts.length > 0) {
                    orderSql = `ORDER BY ${orderParts.join(', ')}`;
                }
            }

            const safeStart = Math.max(0, parseInt(start, 10) || 0);
            const parsedLength = parseInt(length, 10);
            const limitSql = (!isNaN(parsedLength) && parsedLength > 0) ? `LIMIT ${safeStart}, ${parsedLength}` : '';

            const totalCountSql = `SELECT COUNT(*) as total FROM ${table}${joinClause} ${baseWhereSql}`.trim();
            const inTx = typeof this.db.hasActiveTransaction === 'function' && this.db.hasActiveTransaction();

            let totalResult;
            let filteredResult = null;

            if (hasDtSearch) {
                const filteredCountSql = `SELECT COUNT(*) as total FROM ${table}${joinClause} ${whereSql}`.trim();
                if (!inTx) {
                    [totalResult, filteredResult] = await Promise.all([
                        this.executeQuery(totalCountSql, baseWhere.bindings),
                        this.executeQuery(filteredCountSql, finalBindings)
                    ]);
                } else {
                    totalResult = await this.executeQuery(totalCountSql, baseWhere.bindings);
                    filteredResult = await this.executeQuery(filteredCountSql, finalBindings);
                }
            } else {
                totalResult = await this.executeQuery(totalCountSql, baseWhere.bindings);
            }

            if (totalResult && totalResult.error) {
                return { draw: parsedDraw, recordsTotal: 0, recordsFiltered: 0, data: [], error: totalResult.error.message };
            }
            const recordsTotal = Number(totalResult?.[0]?.total || 0);

            if (filteredResult && filteredResult.error) {
                return { draw: parsedDraw, recordsTotal, recordsFiltered: 0, data: [], error: filteredResult.error.message };
            }
            const recordsFiltered = hasDtSearch ? Number(filteredResult?.[0]?.total || 0) : recordsTotal;

            let data = [];
            if (recordsFiltered > 0 && parsedLength !== 0) {
                const selectCols = this._buildSelectColumns(this._qb.fields);
                const dataSql = `SELECT ${selectCols} FROM ${table}${joinClause}${whereSql ? ` ${whereSql}` : ''}${orderSql ? ` ${orderSql}` : ''}${limitSql ? ` ${limitSql}` : ''}`.trim();
                const dataResult = await this.executeQuery(dataSql, finalBindings);
                if (dataResult && dataResult.error) {
                    return { draw: parsedDraw, recordsTotal, recordsFiltered, data: [], error: dataResult.error.message };
                }
                data = Array.isArray(dataResult) ? dataResult : [];
            }

            return {
                draw: parsedDraw,
                recordsTotal,
                recordsFiltered,
                data: this._maskHiddenFields(data),
            };
        } catch (e) {
            console.error('Erro em selectToDatatable:', e);
            if (this.onError) this.onError(e);
            return {
                draw: parsedDraw,
                recordsTotal: 0,
                recordsFiltered: 0,
                data: [],
                error: e.message
            };
        }
    }

    async selectBy(params) {
        const softCol = this._getSoftDeleteColumn();
        const whereConditions = [];

        if (params && typeof params === 'object') {
            for (const [k, v] of Object.entries(params)) {
                if (whereConditions.length > 0) whereConditions.push('AND');
                whereConditions.push({ [k]: v, operator: '=' });
            }
        }

        if (softCol && !this._qb.withTrashed) {
            if (whereConditions.length > 0) whereConditions.push('AND');
            if (this._qb.onlyTrashed) {
                whereConditions.push({ [softCol]: null, operator: 'IS NOT' });
            } else {
                whereConditions.push({ [softCol]: null, operator: 'IS' });
            }
        }

        return await this.select(whereConditions, { FIELDS: this._qb.fields, JOINS: this._qb.joins, WITH_TRASHED: true });
    }

    /**
     * @deprecated Use select() instead.
     */
    async selectOld(params, clauses = {}) {
        return this.select(params, clauses);
    }

    async select(params, clauses = {}, _objectWhereOverride = null) {
        if (params != null && !Array.isArray(params)) {
            const err = new Error('O parâmetro "params" deve ser um array');
            if (this.db && this.db.config && this.db.config.throwOnError) {
                throw err;
            }
            return { error: err };
        }

        const whereTarget = _objectWhereOverride || (Array.isArray(params) ? [...params] : []);
        const softCol = this._getSoftDeleteColumn();
        const withTrashed = clauses.WITH_TRASHED !== undefined ? clauses.WITH_TRASHED : this._qb.withTrashed;
        const onlyTrashed = clauses.ONLY_TRASHED !== undefined ? clauses.ONLY_TRASHED : this._qb.onlyTrashed;

        if (softCol) {
            if (onlyTrashed) {
                if (Array.isArray(whereTarget)) {
                    if (whereTarget.length > 0) whereTarget.push('AND');
                    whereTarget.push({ [softCol]: null, operator: 'IS NOT' });
                } else if (typeof whereTarget === 'object' && whereTarget !== null) {
                    whereTarget[softCol] = { operator: 'IS NOT', value: null };
                }
            } else if (!withTrashed) {
                if (Array.isArray(whereTarget)) {
                    if (whereTarget.length > 0) whereTarget.push('AND');
                    whereTarget.push({ [softCol]: null, operator: 'IS' });
                } else if (typeof whereTarget === 'object' && whereTarget !== null) {
                    whereTarget[softCol] = null;
                }
            }
        }

        const { sql: whereSql, bindings: values } = this._buildWhereClause(whereTarget);
        const whereClause = whereSql ? ` WHERE ${whereSql}` : '';

        const joins = clauses.JOINS || this._qb.joins;
        const joinClause = this._buildJoinClauses(joins);

        const selectCols = this._buildSelectColumns(clauses.FIELDS || this._qb.fields);

        // Sanitização estrita de GROUP BY e ORDER BY
        const safeGroup = clauses.GROUPBY ? sanitizeClauseList(clauses.GROUPBY, false) : '';
        const groupByClause = safeGroup ? ` GROUP BY ${safeGroup}` : '';

        let havingClause = '';
        if (clauses.HAVING) {
            if (typeof clauses.HAVING === 'object' && clauses.HAVING.sql) {
                havingClause = ` HAVING ${clauses.HAVING.sql}`;
                if (Array.isArray(clauses.HAVING.bindings)) {
                    values.push(...clauses.HAVING.bindings);
                }
            } else {
                havingClause = ` HAVING ${clauses.HAVING}`;
            }
        }

        const safeOrder = clauses.ORDERBY ? sanitizeClauseList(clauses.ORDERBY, true) : '';
        const orderClause = safeOrder ? ` ORDER BY ${safeOrder}` : '';
        const descClause = (clauses.DESC && safeOrder && !/\b(ASC|DESC)$/i.test(safeOrder)) ? ` DESC` : '';

        const parsedLimit = clauses.LIMIT !== undefined ? parseInt(clauses.LIMIT, 10) : NaN;
        const limitClause = !isNaN(parsedLimit) && parsedLimit >= 0 ? ` LIMIT ${parsedLimit}` : '';

        const parsedOffset = clauses.OFFSET !== undefined ? parseInt(clauses.OFFSET, 10) : NaN;
        const offsetClause = !isNaN(parsedOffset) && parsedOffset >= 0 ? ` OFFSET ${parsedOffset}` : '';

        const sql = `SELECT ${selectCols} FROM ${this._safeTable()}${joinClause}${whereClause}${groupByClause}${havingClause}${orderClause}${descClause}${limitClause}${offsetClause}`;

        const rows = await this.executeQuery(sql, values);
        return this._maskHiddenFields(rows);
    }

    async insert(params) {
        for (const hook of this._hooks.beforeInsert) {
            await hook(params);
        }

        const stripped = await this._stripUnknownFields(params);
        const data = this._applyTimestampsOnInsert(stripped);

        const sql = `INSERT INTO ${this._safeTable()} SET ?`;
        const result = await this.executeQuery(sql, data, true);

        for (const hook of this._hooks.afterInsert) {
            await hook(result, data);
        }

        return result;
    }

    async insertMany(rowsArray) {
        if (!Array.isArray(rowsArray) || rowsArray.length === 0) {
            throw new Error('insertMany requer um array não vazio de objetos.');
        }

        for (const hook of this._hooks.beforeInsert) {
            for (const row of rowsArray) {
                await hook(row);
            }
        }

        const stripped = await this._stripUnknownFields(rowsArray);
        const dataRows = this._applyTimestampsOnInsert(stripped);

        const columns = Object.keys(dataRows[0]);
        if (columns.length === 0) {
            throw new Error('Os objetos em insertMany devem conter ao menos uma coluna.');
        }

        const safeCols = columns.map(c => safeColumn(c)).join(', ');
        const valuesMatrix = dataRows.map(row => columns.map(col => (row[col] !== undefined ? row[col] : null)));

        const sql = `INSERT INTO ${this._safeTable()} (${safeCols}) VALUES ?`;
        const result = await this.executeQuery(sql, [valuesMatrix], true, { prepare: false });

        for (const hook of this._hooks.afterInsert) {
            await hook(result, dataRows);
        }

        return result;
    }

    async upsert(data, updateColumns = null) {
        if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
            throw new Error('A operação de upsert requer um objeto de dados válido.');
        }

        for (const hook of this._hooks.beforeInsert) {
            await hook(data);
        }

        const stripped = await this._stripUnknownFields(data);
        const preparedData = this._applyTimestampsOnInsert(stripped);

        const dataKeys = Object.keys(preparedData);
        const createdCol = typeof this.timestamps === 'object' && this.timestamps.createdAt ? this.timestamps.createdAt : 'criado_em';
        const updatedCol = typeof this.timestamps === 'object' && this.timestamps.updatedAt ? this.timestamps.updatedAt : 'atualizado_em';

        // Previne a sobrescrita do timestamp de criação original em caso de update
        const defaultUpdateCols = this.timestamps ? dataKeys.filter(k => k !== createdCol) : dataKeys;
        const colsToUpdate = Array.isArray(updateColumns) && updateColumns.length > 0 ? updateColumns : defaultUpdateCols;

        const insertCols = dataKeys.map(k => safeColumn(k)).join(', ');
        const insertPlaceholders = dataKeys.map(() => '?').join(', ');
        const updateParts = colsToUpdate.map(k => {
            const col = safeColumn(k);
            return `${col} = VALUES(${col})`;
        });

        if (this.timestamps && !colsToUpdate.includes(updatedCol) && dataKeys.includes(updatedCol)) {
            updateParts.push(`${safeColumn(updatedCol)} = VALUES(${safeColumn(updatedCol)})`);
        }

        const updateClause = updateParts.join(', ');

        const bindings = dataKeys.map(k => preparedData[k]);
        const sql = `INSERT INTO ${this._safeTable()} (${insertCols}) VALUES (${insertPlaceholders}) ON DUPLICATE KEY UPDATE ${updateClause}`;

        const result = await this.executeQuery(sql, bindings, true);

        for (const hook of this._hooks.afterInsert) {
            await hook(result, preparedData);
        }

        return result;
    }

    async update(params, options = {}) {
        if (!params || typeof params !== 'object' || !params.set || typeof params.set !== 'object' || Object.keys(params.set).length === 0) {
            throw new Error('A operação de update requer um objeto "set" com ao menos um campo.');
        }

        const effectiveWhere = params.where !== undefined
            ? params.where
            : (this._qb.where.length > 0 ? this._qb.where : null);

        for (const hook of this._hooks.beforeUpdate) {
            await hook(params.set, effectiveWhere);
        }

        const strippedSet = await this._stripUnknownFields(params.set);
        const finalSet = this._applyTimestampsOnUpdate(strippedSet);

        const setKeys = Object.keys(finalSet);
        const setClause = setKeys.map(key => `${safeColumn(key)} = ?`).join(', ');
        const setValues = setKeys.map(key => finalSet[key]);

        const { sql: whereClause, bindings: whereValues } = this._buildWhereClause(effectiveWhere, !!options.useRegex);
        if (!whereClause || whereClause.trim() === '') {
            throw new Error('A operação de update requer uma cláusula "where" não vazia para prevenir alterações em toda a tabela.');
        }

        const sql = `UPDATE ${this._safeTable()} SET ${setClause} WHERE ${whereClause}`;
        const values = [...setValues, ...whereValues];

        const result = await this.executeQuery(sql, values, true);

        for (const hook of this._hooks.afterUpdate) {
            await hook(result, finalSet, effectiveWhere);
        }

        return result;
    }

    async delete(conditions) {
        const targetConditions = conditions !== undefined
            ? conditions
            : (this._qb.where.length > 0 ? this._qb.where : null);

        if (!targetConditions || typeof targetConditions !== 'object') {
            return;
        }

        for (const hook of this._hooks.beforeDelete) {
            await hook(targetConditions);
        }

        const softCol = this._getSoftDeleteColumn();
        if (softCol) {
            // Soft delete ativo: realiza UPDATE na coluna de timestamp
            const result = await this.update({
                set: { [softCol]: new Date() },
                where: targetConditions
            });

            for (const hook of this._hooks.afterDelete) {
                await hook(result, targetConditions);
            }
            return result;
        }

        const { sql: whereClause, bindings } = this._buildWhereClause(targetConditions);
        if (!whereClause) {
            return;
        }

        const sql = `DELETE FROM ${this._safeTable()} WHERE ${whereClause}`;
        const result = await this.executeQuery(sql, bindings, true);

        for (const hook of this._hooks.afterDelete) {
            await hook(result, targetConditions);
        }

        return result;
    }

    async forceDelete(conditions) {
        const targetConditions = conditions !== undefined
            ? conditions
            : (this._qb.where.length > 0 ? this._qb.where : null);

        if (!targetConditions || typeof targetConditions !== 'object') {
            return;
        }

        for (const hook of this._hooks.beforeDelete) {
            await hook(targetConditions);
        }

        const { sql: whereClause, bindings } = this._buildWhereClause(targetConditions);
        if (!whereClause) {
            return;
        }

        const sql = `DELETE FROM ${this._safeTable()} WHERE ${whereClause}`;
        const result = await this.executeQuery(sql, bindings, true);

        for (const hook of this._hooks.afterDelete) {
            await hook(result, targetConditions);
        }

        return result;
    }

    async restore(conditions) {
        const targetConditions = conditions !== undefined
            ? conditions
            : (this._qb.where.length > 0 ? this._qb.where : null);

        const softCol = this._getSoftDeleteColumn();
        if (!softCol) {
            throw new Error('O método restore() só pode ser usado quando o Soft Delete estiver ativo.');
        }

        return await this.update({
            set: { [softCol]: null },
            where: targetConditions
        });
    }
}

module.exports = DatabaseHandler;