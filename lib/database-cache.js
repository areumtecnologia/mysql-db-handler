// Áreum Tecnologia - Renan Moreira - renan.moreira@areum.com.br
const mysql = require('mysql2/promise');
const NodeCache = require('node-cache');

class DataBase {
    constructor(config = {}) {
        this.config = config;
        this.pool = mysql.createPool(this.config); // The pool is created once when the instance is created.
        this.cache = new NodeCache({ stdTTL: 100, checkperiod: 120 }); // Cache instance with a default TTL and check period.
    }

    // The createPool method is preserved for compatibility but is not necessary as the pool is already created in the constructor.
    createPool() {
        if (!this.pool) {
            this.pool = mysql.createPool(this.config);
        }
        return this.pool;
    }

    async getConnection() {
        if (!this.pool) {
            throw new Error('Pool de conexões não criado.');
        }
        return this.pool.getConnection();
    }

    async query(sql, params) {
        const key = `query_${sql}_${JSON.stringify(params)}`;
        const cachedResult = this.cache.get(key);

        if (cachedResult) {
            return cachedResult;
        }

        const connection = await this.getConnection();
        try {
            const [rows] = await connection.query(sql, params);
            this.cache.set(key, rows); // Save the result in the cache.
            return rows;
        } catch (error) {
            return { error };
        } finally {
            connection.release();
        }
    }

    // This method now uses placeholders to prevent SQL injection.
    async getTableSchema(table) {
        const key = `schema_${table}`;
        const cachedResult = this.cache.get(key);

        if (cachedResult) {
            return cachedResult;
        }

        const sql = `SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?`;
        const params = [this.config.database, table];

        const connection = await this.getConnection();
        try {
            const [rows] = await connection.execute(sql, params); // Use execute with placeholders
            this.cache.set(key, rows); // Save the result in the cache.
            return rows;
        } catch (error) {
            return { error };
        } finally {
            connection.release();
        }
    }

    // Optional: A method to clear the cache if needed.
    clearCache() {
        this.cache.flushAll();
    }
}

module.exports = DataBase;
