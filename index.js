// Áreum Tecnologia - Renan Moreira - renan.moreira@areum.com.br
const DataBaseCache = require('./lib/database-cache');
const DataBase = require('./lib/database');
const DataBaseHandler = require('./lib/databaseHandler');
// We do not export the singleton by default in a library usually, 
// but we export the classes so the user can instantiate them.

module.exports = {
    DataBase,
    Database: DataBase,
    DataBaseHandler,
    DatabaseHandler: DataBaseHandler,
    DataBaseCache,
    DatabaseCache: DataBaseCache,
    raw: DataBaseHandler.raw
};