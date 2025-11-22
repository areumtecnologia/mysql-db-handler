class DatabaseHandler {
    constructor(database, table, expression = '') {
        this.db = database;
        this.table = table;
        this.debug = false;
        this.expression = expression;
        this.debug = false;
        this.onError;
    }

    async executeQuery(sql, params) {
        // const connection = await this.db;
        // const rows = await connection.query(sql, params);
        const rows = await this.db.query(sql, params);
        return rows;
    }

    async getSchema() {
        return await this.db.getTableSchema(this.table)
    }

    /**
     * @private
     * Converte um objeto "achatado" (form-urlencoded) em um objeto aninhado (JSON).
     * Ex: { 'columns[0][data]': 'id' } => { columns: [{ data: 'id' }] }
     */
    _hydrateObject(flatObject) {
        const result = {};
        for (const key in flatObject) {
            const keys = key.match(/[^[\]']+/g); // Extrai chaves como ['columns', '0', 'data']
            if (!keys) continue;

            let current = result;
            while (keys.length > 1) {
                const k = keys.shift();
                current[k] = current[k] || (isNaN(keys[0]) ? {} : []);
                current = current[k];
            }
            current[keys[0]] = flatObject[key];
        }
        return result;
    }

    _parseStrictCondition(strictCondition) {
        if (!strictCondition || !Array.isArray(strictCondition) || strictCondition.length === 0) {
            return { sql: '', bindings: [] };
        }
        const clauses = [];
        const bindings = [];
        for (const item of strictCondition) {
            if (typeof item === 'string') {
                clauses.push(item.toUpperCase());
            } else if (typeof item === 'object' && item !== null) {
                const key = Object.keys(item).find(k => k !== 'operator');
                if (!key) continue;
                const value = item[key];
                const operator = item.operator || '=';
                clauses.push(`\`${key}\` ${operator} ?`);
                bindings.push(value);
            }
        }
        return { sql: `(${clauses.join(' ')})`, bindings };
    }

    async selectToDatatable(rawDtQuery, strictCondition = []) {
        // NOVO: Hidrata o objeto da requisição para o formato aninhado correto.
        const dtQuery = this._hydrateObject(rawDtQuery);
        const { draw, start, length, search, order, columns } = dtQuery;

        try {
            const baseWhere = this._parseStrictCondition(strictCondition);
            const finalBindings = [...baseWhere.bindings];
            const finalWhereClauses = baseWhere.sql ? [baseWhere.sql] : [];

            const dtSearchClauses = [];
            if (columns) {
                if (search && search.value !== '') {
                    const globalSearch = columns
                        .filter(c => c.data && c.searchable === 'true')
                        .map(c => `\`${c.data}\` LIKE ?`);

                    if (globalSearch.length > 0) {
                        const regexSearch = search.regex === 'true' ? `${search.value}` : `%${search.value}%`;
                        const operator = search.regex === 'true' ? 'REGEXP' : 'LIKE';
                        const clauses = globalSearch.map(c => c.replace('LIKE ?', `${operator} ?`));

                        dtSearchClauses.push(`(${clauses.join(' OR ')})`);
                        for (let i = 0; i < globalSearch.length; i++) {
                            finalBindings.push(regexSearch);
                        }
                    }
                }
                for (const col of columns) {
                    if (col.data && col.searchable === 'true' && col.search && col.search.value !== '') {
                        const regexSearch = col.search.regex === 'true' ? `${col.search.value}` : `%${col.search.value}%`;
                        const operator = col.search.regex === 'true' ? 'REGEXP' : 'LIKE';
                        dtSearchClauses.push(`\`${col.data}\` ${operator} ?`);
                        finalBindings.push(regexSearch);
                    }
                }
            }

            if (dtSearchClauses.length > 0) {
                finalWhereClauses.push(dtSearchClauses.join(' AND '));
            }

            const whereSql = finalWhereClauses.length > 0 ? `WHERE ${finalWhereClauses.join(' AND ')}` : '';

            let orderSql = '';
            if (order && order.length > 0 && columns) {
                const orderColumnIndex = order[0].column;
                if (columns[orderColumnIndex] && columns[orderColumnIndex].orderable === 'true' && columns[orderColumnIndex].data) {
                    const orderColumnName = columns[orderColumnIndex].data;
                    const orderDir = order[0].dir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
                    orderSql = `ORDER BY \`${orderColumnName}\` ${orderDir}`;
                }
            }

            const limitSql = (length && length != '-1') ? `LIMIT ${parseInt(start, 10)}, ${parseInt(length, 10)}` : '';

            // --- Queries ---
            const baseWhereSql = baseWhere.sql ? `WHERE ${baseWhere.sql}` : '';
            const totalCountSql = `SELECT COUNT(*) as total FROM ${this.table} ${baseWhereSql}`;
            const [totalResult] = await this.executeQuery(totalCountSql, baseWhere.bindings);
            const recordsTotal = totalResult.total;

            const filteredCountSql = `SELECT COUNT(*) as total FROM ${this.table} ${whereSql}`;
            const [filteredResult] = await this.executeQuery(filteredCountSql, finalBindings);
            const recordsFiltered = filteredResult.total;

            // CORREÇÃO: Construção segura da cláusula SELECT para evitar vírgulas duplas.
            const selectFields = ['*'];
            if (this.expression && this.expression.trim() !== '') {
                // Remove vírgula do início da expressão, se houver, para evitar duplicação
                selectFields.push(this.expression.trim().replace(/^,/, '').trim());
            }
            const dataSql = `SELECT ${selectFields.join(', ')} FROM ${this.table} ${whereSql} ${orderSql} ${limitSql}`;
            const data = await this.executeQuery(dataSql, finalBindings);

            return {
                draw: parseInt(draw || 0),
                recordsTotal: parseInt(recordsTotal),
                recordsFiltered: parseInt(recordsFiltered),
                data: data,
            };

        } catch (e) {
            console.error("Erro em selectToDatatable:", e);
            if (this.onError) this.onError(e);
            return {
                draw: parseInt(dtQuery.draw || 0),
                recordsTotal: 0,
                recordsFiltered: 0,
                data: [],
                error: e.message
            };
        }
    }

    async selectBy(params) {
        if (params) {
            const sql = `SELECT *${this.expression ? this.expression : ''} FROM ${this.table} WHERE ?`;
            const rows = await this.executeQuery(sql, params);
            return rows;//retorna um array, mesmo que vazio
        }
        else {
            const sql = `SELECT *${this.expression ? this.expression : ''} FROM ${this.table}`;
            return this.executeQuery(sql);
        }
    }

    async select(params, clauses = {}) {
        if (params != null && !Array.isArray(params)) {
            return new Error('O parâmetro "params" deve ser um array');
        }

        const conditions = [];
        const values = [];

        if (params && params.length) {
            params.map((param) => {
                if (typeof param === 'object' && !Array.isArray(param)) {
                    const entries = Object.entries(param);
                    const [key, value] = entries[0];
                    const [operator, opValue] = entries[1] || [];

                    const condition = `\`${key}\` ${opValue ?? '='} ?`;
                    conditions.push(condition);
                    values.push(value);
                } else if (typeof param === 'string') {
                    conditions.push(param.toUpperCase());
                }
            });
        }

        const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' ')}` : '';

        // Cláusulas adicionais
        const groupByClause = clauses['GROUPBY'] ? ` GROUP BY ${clauses['GROUPBY']}` : '';
        const havingClause = clauses['HAVING'] ? ` HAVING ${clauses['HAVING']}` : '';
        const orderClause = clauses['ORDERBY'] ? ` ORDER BY ${clauses['ORDERBY']}` : '';
        const limitClause = clauses['LIMIT'] ? ` LIMIT ${clauses['LIMIT']}` : '';
        const offsetClause = clauses['OFFSET'] ? ` OFFSET ${clauses['OFFSET']}` : '';

        const sql = `SELECT *${this.expression ?? ''} FROM ${this.table}${whereClause}${groupByClause}${havingClause}${orderClause}${limitClause}${offsetClause}`;

        const rows = await this.executeQuery(sql, values);
        return rows;
    }

    async insert(params) {
        const sql = `INSERT INTO ${this.table} SET ?`;
        const result = await this.executeQuery(sql, params);
        return result;
    }

    async update(params, options = {}) {
        // Inicializa a string SQL para a cláusula SET
        const operator = options.useRegex ? 'REGEXP' : '=';
        let setClause = Object.keys(params.set).map(key => `\`${key}\` = ?`).join(', ');
        // Inicializa a string SQL para a cláusula WHERE
        let whereClause = Object.keys(params.where).map(key => `\`${key}\` ${operator} ?`).join(' AND ');
        // Constrói a consulta SQL completa
        const sql = `UPDATE ${this.table} SET ${setClause} WHERE ${whereClause}`;
        // Combina os valores SET e WHERE em um único array
        const values = [...Object.values(params.set), ...Object.values(params.where)];
        // Executa a consulta
        const result = await this.executeQuery(sql, values);

        return result;
    }

    async delete(conditions) {
        const conditionKeys = Object.keys(conditions);
        if (conditionKeys.length === 0) {
            // Se o objeto conditions estiver vazio, não faz nada
            return;
        }

        const whereConditions = conditionKeys.map((key) => `${key} = ?`).join(' AND ');
        const sql = `DELETE FROM ${this.table} WHERE ${whereConditions}`;
        const params = conditionKeys.map((key) => conditions[key]);
        const result = await this.executeQuery(sql, params);
        return result;
    }

}

module.exports = DatabaseHandler;
