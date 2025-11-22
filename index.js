// Áreum Tecnologia - Renan Moreira - renan.moreira@areum.com.br
const DataBase = require('./lib/database');
const DataBaseHandler = require('./lib/databaseHandler');
// We do not export the singleton by default in a library usually, 
// but we export the classes so the user can instantiate them.

module.exports = {
    DataBase,
    DataBaseHandler
};