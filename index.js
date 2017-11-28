const DB = require('./lib/db');
const Ctrl = require('./lib/ctrl');
const _ = require('lodash');
const async = require('async');

/**
 *
 * @param tableName
 * @returns Table
 * @constructor
 */
const BrestPG = {};

BrestPG.Table = require('./classes/table');
BrestPG.Controller = require('./classes/controller');

/**
 * Init extension within Brest
 * @param brest
 * @param callback
 */
BrestPG.before_static_init = function(brest, callback) {
   async.waterfall([
     next => {
       BrestPG.db = new DB();
       brest.db = BrestPG.db;
       BrestPG.db.connect(brest, brest.getSetting('postgres'), next)
     },
     next => {
       BrestPG.controllers = new Ctrl();
       BrestPG.controllers.init(brest, next)
     }
   ], callback);
};

BrestPG.tbl = function(table_name) {
    return BrestPG.db.tables[table_name];
};

BrestPG.ctrl = function(table_name) {
    return BrestPG.controllers.get(table_name);
};

BrestPG.CONFLICT_DO_UPDATE = 'do_update';
BrestPG.CONFLICT_DO_NOTHING = 'do_nothing';

BrestPG.filters = {
    limit: {description: "Limit the request <%count%>,<%from%>", toArray: true},
    order: {description: "Sort by the fields"}
};

module.exports = BrestPG;