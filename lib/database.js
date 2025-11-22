const mysql = require('mysql2/promise');

class DataBase {
    /**
     * Creates a database instance with a connection pool.
     * @param {Object} [config] - Configuration object for the database connection.
     */
    constructor(config) {
        this.id = Date.now();
        this.config = config;
        this.pool = mysql.createPool(config);
    }

    /**
     * Retrieves the connection pool.
     * @returns {Promise<mysql.Pool>} The connection pool.
     */
    getPool() {
        return this.pool;
    }

    /**
     * Gets a connection from the pool.
     * @returns {Promise<mysql.PoolConnection>} A database connection.
     */
    async getConnection() {
        return this.pool.getConnection();
    }

    /**
     * Executes a SQL query using a pooled connection.
     * @param {string} sql - The SQL query to execute.
     * @param {Array} [params] - The parameters for the SQL query.
     * @returns {Promise<Array>} The result set from the query.
     * @throws {Error} Throws an error if the query fails.
     */
    async query(sql, params) {
        let connection; // Mova a declaração da conexão para fora do bloco try
        try {
            // Passo 1: Obter uma conexão do pool
            connection = await this.getConnection();

            // Passo 2: Executar a query
            const [rows] = await connection.query(sql, params);
            return rows;
        } catch (error) {
            // Passo 3: Se a query falhar, logar e retornar o erro no formato desejado
            console.error('Erro na execução da query:', error);
            return { error }; // Mantém o retorno do erro como um objeto
        } finally {
            // Passo 4: Este bloco SEMPRE será executado, independentemente de sucesso ou falha no 'try'
            if (connection) {
                connection.release(); // Garante que a conexão seja devolvida ao pool
            }
        }
    }

    /**
     * Retrieves the schema of a given table using prepared statements to prevent SQL injection.
     * @param {string} table - The name of the table.
     * @returns {Promise<Array>} The schema of the table.
     * @throws {Error} Throws an error if the query fails.
     */
    async getTableSchema(table) {
        const sql = `SELECT column_name 
                     FROM information_schema.columns 
                     WHERE table_schema = ? AND table_name = ?`;
        return await this.query(sql, [this.config.database, table]);
    }

    /**
     * Closes the connection pool.
     */
    async close() {
        if (this.pool) {
            await this.pool.end();
            console.log(new Date().toLocaleString('pt-br'), 'POOL', 'Database connection pool closed.');
        }
    }
}
module.exports = DataBase;
