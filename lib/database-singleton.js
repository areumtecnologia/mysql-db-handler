// Áreum Tecnologia - Renan Moreira - renan.moreira@areum.com.br
// src/database/database-singleton.js
// Exemplo Singleton para a conexão com o banco de dados
const { DB_HOST, DB_USER, DB_PASS } = require('../constants');
const DataBase = require("./database");

const dbi = new DataBase({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASS,
    database: '',
    charset: "utf8mb4",
    timezone: "-03:00",
    connectionLimit: 1, // Ajustado para um limite de conexão mais comum
    waitForConnections: true,
    queueLimit: 0
});
// console.log("DATABASE SINGLETON CREATED", dbi.id);
module.exports = dbi;