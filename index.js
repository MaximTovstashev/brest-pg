var DB = require('./lib/db');
var Ctrl = require('./lib/ctrl');
var _ = require('lodash');

/**
 *
 * @param tableName
 * @returns Table
 * @constructor
 */
var BrestPG = {};

BrestPG.Table = require('./classes/table');
BrestPG.Controller = require('./classes/controller');

// BrestPG.resource = {
//     init: function (resource, callback) {
//         callback();
//     }
// };

/**
 * Init extension within Brest
 * @param brest
 * @param callback
 */
BrestPG.init = function(brest, callback) {
    BrestPG.db = new DB(brest.getSetting('postgres'));
    BrestPG.controllers = new Ctrl(brest);
    brest.db = BrestPG.db;
    BrestPG.db.on('error', function(err) {callback(err)});
    BrestPG.db.on('ready',
        () => {
            BrestPG.controllers.init(brest, function(err){
                callback(err);
            });
        }
    );
};

BrestPG.tbl = function(table_name) {
    return BrestPG.db.tables[table_name];
};

BrestPG.ctrl = function(table_name) {
    return BrestPG.controllers.get(table_name);
};

BrestPG.filters = {
    limit: {description: "Limit the request <%count%>,<%from%>"},
    order: {description: "Sort by the fields"}
};

module.exports = BrestPG;