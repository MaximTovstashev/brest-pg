var DB = require('./lib/db');
var _ = require('lodash');

/**
 *
 * @param tableName
 * @returns Table
 * @constructor
 */
var BrestPG = function(tableName)
{
    if (tableName) return BrestPG.db.table(tableName);
    else return BrestPG.db.table;
};

BrestPG.Table = require('./lib/table');

BrestPG.init = function(brest, callback) {
    BrestPG.db = new DB(brest.getSetting('postgres'));
    brest.db = BrestPG.db;
    BrestPG.db.on('error', function(err) {callback(err)});
    BrestPG.db.on('ready', callback);
};

module.exports = BrestPG;