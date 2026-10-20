const mysql = require('mysql2/promise');
const { AsyncLocalStorage } = require('node:async_hooks');

const ALLOWED_ISOLATION_LEVELS = new Set([
    'READ UNCOMMITTED',
    'READ COMMITTED',
    'REPEATABLE READ',
    'SERIALIZABLE'
]);

// Códigos de erro transientes do MySQL passíveis de retry automático
const RETRYABLE_ERROR_CODES = new Set([
    'ER_LOCK_DEADLOCK',     // errno 1213
    'ER_LOCK_WAIT_TIMEOUT'  // errno 1205
]);

function validateIsolationLevel(level) {
    if (!level) return null;
    const normalized = String(level).toUpperCase().trim();
    if (!ALLOWED_ISOLATION_LEVELS.has(normalized)) {
        throw new Error(`Nível de isolamento inválido: "${level}". Valores válidos: ${Array.from(ALLOWED_ISOLATION_LEVELS).join(', ')}`);
    }
    return normalized;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class DataBase {
    /**
     * @param {Object} [config] - Configuração do MySQL2 + opções estendidas:
     * @param {boolean} [config.throwOnError=false] - Lança erros fora de transações.
     * @param {boolean} [config.usePreparedStatements=false] - Usa .execute() por defeito em vez de .query().
     * @param {number} [config.slowQueryThreshold=0] - Limite em ms para emitir alerta de query lenta (0 = desativado).
     * @param {Function} [config.onSlowQuery] - Callback ({ sql, params, durationMs }) chamado em queries lentas.
     * @param {Object} [config.logger=console] - Logger customizado (Pino, Winston, console).
     * @param {number} [config.maxRetries=3] - Número máximo de tentativas em caso de Deadlock em transações.
     * @param {number} [config.retryDelayMs=50] - Atraso base (ms) para backoff exponencial em Deadlocks.
     */
    constructor(config = {}) {
        this.id = Date.now();
        this.config = config;
        this.logger = config.logger || console;
        this.slowQueryThreshold = Number(config.slowQueryThreshold) || 0;
        this.onSlowQuery = typeof config.onSlowQuery === 'function' ? config.onSlowQuery : null;
        this.usePreparedStatements = Boolean(config.usePreparedStatements);
        this.maxRetries = config.maxRetries !== undefined ? Number(config.maxRetries) : 3;
        this.retryDelayMs = config.retryDelayMs !== undefined ? Number(config.retryDelayMs) : 50;

        // Extrai apenas opções válidas do mysql2 para evitar avisos de configuração desconhecida
        const {
            throwOnError,
            usePreparedStatements,
            slowQueryThreshold,
            onSlowQuery,
            logger,
            maxRetries,
            retryDelayMs,
            replicas,
            readReplicas,
            read,
            ...mysqlConfig
        } = config;

        this.pool = mysql.createPool(mysqlConfig);
        this.als = new AsyncLocalStorage();

        // Replicação de Leitura/Escrita (Read/Write Splitting)
        const replicaList = replicas || readReplicas || (Array.isArray(read) ? read : null);
        this.replicaPools = [];
        this._replicaIndex = 0;

        if (Array.isArray(replicaList) && replicaList.length > 0) {
            this.replicaPools = replicaList.map(repConfig => {
                return mysql.createPool({ ...mysqlConfig, ...repConfig });
            });
        }
    }

    _selectPool(isWrite = false) {
        if (isWrite || this.hasActiveTransaction() || this.replicaPools.length === 0) {
            return this.pool;
        }
        const pool = this.replicaPools[this._replicaIndex % this.replicaPools.length];
        this._replicaIndex = (this._replicaIndex + 1) % this.replicaPools.length;
        return pool;
    }

    getPool(isWrite = false) {
        return this._selectPool(isWrite);
    }

    async getConnection(isWrite = false) {
        return this._selectPool(isWrite).getConnection();
    }

    getCurrentTransaction() {
        return this.als.getStore() || null;
    }

    hasActiveTransaction() {
        const store = this.als.getStore();
        return !!(store && store.transactionStarted);
    }

    onCommit(callback) {
        if (typeof callback !== 'function') {
            throw new TypeError('O callback de onCommit deve ser uma função.');
        }

        const store = this.als.getStore();
        if (store && store.transactionStarted && store.onCommitHooks) {
            store.onCommitHooks.push(callback);
        } else {
            Promise.resolve().then(callback).catch(err => {
                this.logger.error('Erro ao executar callback de onCommit fora de transação:', err);
            });
        }
    }

    /**
     * Executa um callback dentro de uma transação gerida com suporte a Savepoints e Auto-Retry de Deadlocks.
     */
    async transaction(callback, options = {}) {
        if (typeof callback !== 'function') {
            throw new TypeError('O parâmetro callback deve ser uma função.');
        }

        const activeStore = this.als.getStore();

        // Se estiver num contexto lazy (autoTransaction), garante a inicialização da conexão antes de prosseguir
        if (activeStore && !activeStore.transactionStarted && typeof activeStore.ensureConnection === 'function') {
            await activeStore.ensureConnection();
        }

        // Transação Aninhada (Savepoint)
        if (activeStore && activeStore.transactionStarted && activeStore.connection) {
            activeStore.depth = (activeStore.depth || 1) + 1;
            activeStore.savepointCounter = (activeStore.savepointCounter || 0) + 1;
            const spName = `sp_${activeStore.savepointCounter}`;
            const hooksLengthBefore = activeStore.onCommitHooks ? activeStore.onCommitHooks.length : 0;

            await activeStore.connection.query(`SAVEPOINT ${spName}`);
            try {
                const result = await callback(activeStore);
                await activeStore.connection.query(`RELEASE SAVEPOINT ${spName}`);
                return result;
            } catch (error) {
                if (activeStore.onCommitHooks) {
                    activeStore.onCommitHooks.length = hooksLengthBefore;
                }
                await activeStore.connection.query(`ROLLBACK TO SAVEPOINT ${spName}`);
                throw error;
            } finally {
                activeStore.depth--;
            }
        }

        // Transação Raiz com suporte a Retry em Deadlocks
        const retries = options.retries !== undefined ? Number(options.retries) : this.maxRetries;
        const baseDelay = options.retryDelayMs !== undefined ? Number(options.retryDelayMs) : this.retryDelayMs;
        const validIsoLevel = options.isolationLevel ? validateIsolationLevel(options.isolationLevel) : null;

        let attempt = 0;
        while (true) {
            let connection = null;
            const onCommitHooks = [];

            try {
                connection = await this.getConnection(true);

                if (validIsoLevel) {
                    await connection.query(`SET TRANSACTION ISOLATION LEVEL ${validIsoLevel}`);
                }

                await connection.beginTransaction();

                const txContext = {
                    id: `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                    db: this,
                    connection,
                    depth: 1,
                    savepointCounter: 0,
                    onCommitHooks,
                    transactionStarted: true,
                    isLazy: false,
                    attempt,
                    query: (sql, params, isWrite, queryOpts) => this.query(sql, params, isWrite, queryOpts),
                    getTableSchema: (table) => this.getTableSchema(table)
                };

                const result = await this.als.run(txContext, () => callback(txContext));

                await connection.commit();

                for (const hook of onCommitHooks) {
                    try {
                        await hook();
                    } catch (hookErr) {
                        this.logger.error('Erro ao executar hook de onCommit:', hookErr);
                    }
                }

                return result;
            } catch (error) {
                if (connection) {
                    try {
                        await connection.rollback();
                    } catch (rbErr) {
                        this.logger.error('Erro durante rollback da transação:', rbErr);
                    }
                }

                const isRetryable = error && (RETRYABLE_ERROR_CODES.has(error.code) || error.errno === 1213 || error.errno === 1205);
                if (isRetryable && attempt < retries) {
                    attempt++;
                    // Backoff exponencial com jitter aleatório
                    const delay = baseDelay * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 25);
                    this.logger.warn(`Deadlock/Lock timeout detetado (${error.code}). Tentativa ${attempt}/${retries} em ${delay}ms...`);
                    await sleep(delay);
                    continue;
                }

                throw error;
            } finally {
                if (connection) {
                    connection.release();
                }
            }
        }
    }

    transactional(fn, options = {}) {
        return (...args) => this.transaction(() => fn(...args), options);
    }

    autoTransaction(options = {}) {
        const {
            methods = ['POST', 'PUT', 'DELETE', 'PATCH'],
            lazy = true,
            isolationLevel = null
        } = options;

        const validIsoLevel = isolationLevel ? validateIsolationLevel(isolationLevel) : null;

        return (req, res, next) => {
            const method = req.method ? req.method.toUpperCase() : 'GET';
            const isTargetMethod = methods.includes(method);

            if (!isTargetMethod && !lazy) {
                return next();
            }

            const onCommitHooks = [];
            let connection = null;
            let connectionPromise = null;
            let finalized = false;

            const txContext = {
                id: `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                db: this,
                connection: null,
                depth: 1,
                savepointCounter: 0,
                onCommitHooks,
                isLazy: lazy,
                transactionStarted: false,
                query: (sql, params, isWrite, queryOpts) => this.query(sql, params, isWrite, queryOpts),
                getTableSchema: (table) => this.getTableSchema(table),
                ensureConnection: async () => {
                    if (connection) return connection;
                    if (!connectionPromise) {
                        connectionPromise = (async () => {
                            const conn = await this.getConnection(true);
                            try {
                                if (validIsoLevel) {
                                    await conn.query(`SET TRANSACTION ISOLATION LEVEL ${validIsoLevel}`);
                                }
                                await conn.beginTransaction();
                                connection = conn;
                                txContext.connection = conn;
                                txContext.transactionStarted = true;
                                return conn;
                            } catch (err) {
                                conn.release();
                                connectionPromise = null;
                                throw err;
                            }
                        })();
                    }
                    return connectionPromise;
                }
            };

            const cleanup = async (shouldCommit) => {
                if (finalized) return;
                finalized = true;

                if (connectionPromise) {
                    try {
                        await connectionPromise;
                    } catch {
                        return;
                    }
                }

                if (connection && txContext.transactionStarted) {
                    try {
                        if (shouldCommit) {
                            await connection.commit();
                            for (const hook of onCommitHooks) {
                                try {
                                    await hook();
                                } catch (hookErr) {
                                    this.logger.error('Erro ao executar hook de onCommit no middleware:', hookErr);
                                }
                            }
                        } else {
                            await connection.rollback();
                        }
                    } catch (err) {
                        this.logger.error('Erro finalizando transação no autoTransaction middleware:', err);
                    } finally {
                        connection.release();
                        txContext.connection = null;
                        txContext.transactionStarted = false;
                    }
                }
            };

            const originalEnd = res.end;
            let finishHandled = false;

            const handleFinish = async (isError) => {
                if (finishHandled) return;
                finishHandled = true;
                const status = res.statusCode || 200;
                const shouldCommit = !isError && status < 400;
                await cleanup(shouldCommit);
            };

            res.end = function (...args) {
                handleFinish(false)
                    .catch(err => console.error('Erro ao finalizar resposta em autoTransaction:', err))
                    .finally(() => originalEnd.apply(this, args));
            };

            res.on('close', () => {
                if (!finishHandled) {
                    handleFinish(true).catch(err => this.logger.error('Erro no evento close:', err));
                }
            });

            this.als.run(txContext, () => {
                try {
                    next();
                } catch (err) {
                    handleFinish(true).finally(() => next(err));
                }
            });
        };
    }

    _recordSlowQuery(sql, params, startTime) {
        if (this.slowQueryThreshold <= 0 && !this.onSlowQuery) return;
        const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;
        if (this.slowQueryThreshold > 0 && durationMs >= this.slowQueryThreshold) {
            this.logger.warn(`[Slow Query: ${durationMs.toFixed(2)}ms] ${sql}`);
            if (this.onSlowQuery) {
                try {
                    this.onSlowQuery({ sql, params, durationMs });
                } catch (err) {
                    this.logger.error('Erro no callback onSlowQuery:', err);
                }
            }
        }
    }

    /**
     * Executa uma query SQL com suporte a transações, telemetria e prepared statements.
     * @param {string} sql - Query SQL.
     * @param {Array|Object} [params] - Parâmetros da query.
     * @param {boolean} [isWrite=false] - Indica se é escrita.
     * @param {Object} [options] - Opções adicionais ({ prepare: boolean, table: string }).
     */
    async query(sql, params, isWrite = false, options = {}) {
        const store = this.als.getStore();
        const usePrepare = options.prepare !== undefined ? options.prepare : this.usePreparedStatements;
        // Prepared statements binários (.execute) do mysql2 não suportam objetos literais para "SET ?" ou arrays aninhados de bulk insert
        const canUseExecute = usePrepare && (params === undefined || (Array.isArray(params) && !params.some(Array.isArray)));
        const method = canUseExecute ? 'execute' : 'query';
        const trackTime = this.slowQueryThreshold > 0 || Boolean(this.onSlowQuery);
        const startTime = trackTime ? process.hrtime.bigint() : 0n;

        if (store) {
            let connection = store.connection;

            if (!connection && store.ensureConnection && (isWrite || !store.isLazy)) {
                connection = await store.ensureConnection();
            }

            if (connection) {
                try {
                    const [rows] = await connection[method](sql, params);
                    if (trackTime) this._recordSlowQuery(sql, params, startTime);
                    return rows;
                } catch (error) {
                    this.logger.error('Erro na execução da query transacional:', error);
                    throw error;
                }
            }
        }

        try {
            const targetPool = this._selectPool(isWrite);
            const [rows] = await targetPool[method](sql, params);
            if (trackTime) this._recordSlowQuery(sql, params, startTime);
            return rows;
        } catch (error) {
            this.logger.error('Erro na execução da query:', error);
            if (this.config && this.config.throwOnError) {
                throw error;
            }
            return { error };
        }
    }

    /**
     * Atalho explícito para Prepared Statements binários no servidor MySQL.
     */
    async execute(sql, params = [], isWrite = false, options = {}) {
        return this.query(sql, params, isWrite, { ...options, prepare: true });
    }

    async getTableSchema(table) {
        const sql = `SELECT column_name 
                     FROM information_schema.columns 
                     WHERE table_schema = COALESCE(?, DATABASE()) AND table_name = ?`;
        const dbName = (this.config && this.config.database) ? this.config.database : null;
        return await this.query(sql, [dbName, table], false, { table });
    }

    async close() {
        if (this.pool) {
            await this.pool.end();
        }
        if (Array.isArray(this.replicaPools) && this.replicaPools.length > 0) {
            await Promise.all(this.replicaPools.map(p => p.end()));
        }
        this.logger.log(new Date().toLocaleString('pt-BR'), 'POOL', 'Database connection pools closed.');
    }
}

module.exports = DataBase;