var async = require('async'),
    format = require('pg-format'),
    util = require('util'),
    _ = require('lodash');

const KEY_PRIMARY = 'PRIMARY KEY';
const KEY_FOREIGN = 'FOREIGN KEY';

class Table {

    /**
     *
     * @param {DB} db
     * @param table_name
     */
    constructor(db, table_name) {
        this.name = table_name;
        this.columns = {};
        this.persistentUpdatesSuspended = 0;
        this.db = db;
    }

    init(callback) {
        var self = this;
        async.waterfall([
            /**
             * Request columns info
             * @param next
             */
            function(next) {
                self.db.query(`
                                SELECT column_name 
                                FROM information_schema.columns 
                                WHERE table_name = %L;`, self.name, next);
            },

            /**
             * Request constraints info
             * @param columns
             * @param next
             */
            function(columns, next) {
                self.columns = {};
                _.each(columns, function(column) {
                    self.columns[column.column_name] = {name: column.column_name}
                });
                self.db.query(`
                                SELECT
                                    kcu.column_name, constraint_type
                                FROM 
                                    information_schema.table_constraints AS tc 
                                JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
                                JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
                                WHERE constraint_type IN (%L) AND tc.table_name=%L;`, [[KEY_PRIMARY, KEY_FOREIGN], self.name], next);
            },

            /**
             * Fill constraints
             * @param constraints
             * @param next
             */
            function(constraints, next) {
                var constraint_found = false;
                self.primary = [];
                self.defaultIds = [];
                _.each(constraints, function(constraint) {
                    if (constraint.constraint_type == KEY_PRIMARY) {
                        self.columns[constraint.column_name].is_primary = true;
                        constraint_found = true;
                        self.primary.push(constraint.column_name);
                        self.defaultIds.push(util.format('%s.%s = %L', self.name, constraint.column_name));
                    }
                    if (constraint.constraint_type == KEY_FOREIGN) {
                        self.columns[constraint.column_name].is_foreign = true;
                        constraint_found = true;
                    }
                });
                if (!constraint_found) console.log(`[WARNING] No constraints on table ${self.name}`);
                next();
            },

            /**
             * Initialise filters and queries
             * @param next
             */
            function(next) {
                //Set default filters for all table columns
                var defaultFilters = {};
                _.each(self.columns, function(props, column){
                    defaultFilters[column] = {where: util.format(" AND %s.%s = %L", self.name, column)};
                    defaultFilters[column+'s'] = {where: util.format(" AND %s.%s IN (%L)", self.name, column)};
                    defaultFilters['not_'+column] = {where: util.format(" AND %s.%s <> %L", self.name, column)};
                    defaultFilters['not_'+column+'s'] = {where: util.format(" AND %s.%s NOT IN (%L)", self.name, column)};
                    defaultFilters['null_'+column] = {where: util.format(" AND IS NULL %s.%s", self.name, column)};
                    defaultFilters['not_null_'+column] = {where: util.format(" AND IS NOT NULL %s.%s", self.name, column)};
                });

                //Use class filters (if any) with default filters fallback
                self.filters = _.defaults(self.filters || {}, defaultFilters);

                //If the queries are already defined in model class, we use them instead of default queries
                self.queries = _.defaults(self.queries || {}, {
                    row: `SELECT {{columns}}{{select}} FROM ${self.name}{{join}} WHERE {{whereClause}} {{where}} {{group}} {{having}} {{order}} LIMIT 1`,
                    list: `SELECT {{columns}}{{select}} FROM ${self.name}{{join}} WHERE 1{{where}} {{group}} {{having}} {{order}} {{limit}}`,
                    insert: `INSERT INTO ${self.name} ({{columns}}) VALUES ({{values}}){{duplicate}}`,
                    update: `UPDATE ${self.name} SET {{columns}} WHERE ${self.defaultIds}`,
                    del: `DELETE FROM ${self.name} WHERE ${self.defaultIds}`,
                    delWhere: `DELETE FROM ${self.name} WHERE 1 {{where}}`,
                    count: `SELECT COUNT(*) as cnt FROM ${self.name} WHERE 1 {{where}}`
                });

                self.persistentAssoc = self.persistentAssoc || {};

                next();
            }
        ], callback);

    };

    /**
     * Prevent persistent fields updates from being fired
     */
    suspendPersistentUpdates() {
        this.persistentUpdatesSuspended++;
        console.log("Persistent lock for table '" + self.name + "' is set to " + self.persistentUpdatesSuspended);
    };

    /**
     * Make persistent updates possible again
     * @param callback
     * @param preventUpdating
     */
    resumePersistentUpdates(callback, preventUpdating) {
        var self = this;
        self.persistentUpdatesSuspended = Math.max(self.persistentUpdatesSuspended - 1, 0);
        console.log("Persistent lock for table '" + self.name + "' is set to " + self.persistentUpdatesSuspended);
        if (self.persistentUpdatesSuspended == 0 && !preventUpdating) {
            self.updatePersistent(function(err){
                if (err) {
                    console.log('ERROR UPDATING PERSISTENT ' + self.name, err);
                }
                callback(err);
            });
        } else {
            if (_.isFunction(callback)) {
                callback();
            }
        }
    };

    /**
     * Call persistent data update functions
     * @param callback
     */
    updatePersistent(callback){
        var self = this;
        if ((self.persistent || self.persistentAssoc)  && self.persistentUpdatesSuspended == 0) {
            self.suspendPersistentUpdates();
            async.waterfall([
                function(callback) {
                    if (self.persistent) {
                        async.forEachOf(self.persistent, function (persistent, key, callback) {
                            if (_.isFunction(persistent)) {
                                persistent(function (err, data) {
                                    self.p[key] = data || false;
                                    callback(err);
                                });
                            } else {
                                console.log('Attempted to build persistent', key, 'with', persistent);
                                callback({error: 'Persistent update function is not a function'});
                            }
                        }, callback)
                    } else callback();
                },
                function(callback) {
                    if (self.persistentAssoc) {
                        async.forEachOf(self.persistentAssoc, function (id_field, key, callback) {
                            self.list(function (err, list_elements) {
                                if (err) callback(err);
                                else {
                                    var assoc = {};
                                    _.each(list_elements, function (list_element) {
                                        assoc[list_element[id_field]] = list_element;
                                    });
                                    self.p[key] = assoc;
                                    self[key] = (function (key) {
                                        return function (id) {
                                            return self.p[key][id]
                                        };
                                    })(key);
                                    callback();
                                }
                            });
                        }, callback);
                    } else callback();
                }
            ], function(err){
                self.resumePersistentUpdates(null, true);
                callback(err);
            });

        } else callback();
    };

    /**
     * Inject sorting into the request
     * @param sql
     * @param filters
     * @returns {*}
     */
    injectSort(sql, filters){
        if (filters['order']) {
            var sort = filters['order'].split(',');
            if (_.isArray(sort)){
                var direction = 'ASC';
                if (sort.indexOf('desc')>-1){
                    direction = 'DESC';
                    delete sort[sort.indexOf('desc')];
                }
                if (sort.length) {
                    var fields = sort.join(", ");
                    sql = sql.replace('{{order}}', util.format(" ORDER BY %s %s", fields, direction));
                }
            } else throw "Failed to parse order filter"
        }
        return sql;
    };

    /**
     * Inject limit into the request
     * @param sql
     * @param filters
     */
    injectLimit(sql, filters){
        if (filters['limit']) {
            var limit = filters['limit'].split(',');
            if (_.isArray(limit)){
                for (var i=0; i<limit.length; i++){
                    limit[i] = parseInt(limit[i]);
                }
                sql = sql.replace('{{limit}}', util.format(" LIMIT %s", limit.join(', ')))
            } else throw "Failed to parse limit filter"
        }
        return sql;
    };

    /**
     * Select one row as an object
     * @param {int|String|Object} ids
     * @param {Object} filters
     * @param {Function} callback
     */
    row(ids, filters, callback){
        var self = this;
        if (_.isFunction(filters)) {
            callback = filters;
            filters = {};
        }
        if (!_.isFunction(callback)) throw new Error("Callback must be a function");

        var whereClause = "";
        if (!_.isObject(ids)) {
            var params = {};
            params[self.primary[0]] = ids;
            ids = params;
            whereClause = self.defaultIds;
        } else {
            var fields = [];
            _.each(ids, function(){
                fields.push("%L")
            });
            whereClause = fields.join(" AND ");
        }

        var columns = [];
        _.each(self.columns, function(column, name){
            columns.push(`${self.name}.${name}`);
        });
        var sql = self.queries.row
            .replace('{{columns}}', columns.join(', '))
            .replace('{{whereClause}}', whereClause);

        sql = self.db.injectFilters(sql, filters, self.filters);
        self.db.row(sql, ids, callback);
    };

    /**
     * Select data by query as an array of objects
     * @param {Object} filters
     * @param {Function} callback
     */
    list(filters, callback) {
        if (_.isFunction(filters)) {
            callback = filters;
            filters = {};
        } else {
            if (!_.isObject(filters)) {
                console.log("WARNING. Invalid filters provided for " + self.name + ".list(). Object required");
                console.log(filters);
                filters = {};
            }
        }
        if (!_.isFunction(callback)) throw new Error("Callback must be a function");

        var columns = [];
        _.each(self.columns, function (column, name) {
            columns.push(`${self.name}.${name}`);
        });

        var sql = self.queries.list.replace('{{columns}}', columns.join(', '));
        sql = self.injectLimit(sql, filters);
        sql = self.injectSort(sql, filters);
        sql = self.db.injectFilters(sql, filters, self.filters);
        return self.db.query(sql, callback);
    };


    /**
     * Insert
     * @param {Object} data
     * @param {Object} options
     * @param {Function} callback
     */
    insert(data, options, callback) {
        var self = this;
        if (_.isFunction(options)) {
            callback = options;
            options = {};
        }

        if (!options) options = {};

        var insert_data = _.pick(data, _.keys(self.columns));

        var sql = self.queries.insert
            .replace('{{columns}}', '%I')
            .replace('{{values}}', '%L')
            .replace('{{duplicate}}', duplicate);

        var q = self.db.query(sql, [_.keys(insert_data), _.values(insert_data)], function(err, res){
            if (err) callback(err);
            else {
                callback(null, {'id':  res.insertId});
                self.updatePersistent(function(err){
                    if (err) console.log('\nERROR: persistent fields update failed for ', self.name, 'with error:\n'+err);
                });
            }
        });
    };

    /**
     * Update
     * @param data
     * @param options
     * @param callback
     */
    update(data, options, callback) {
        var self = this;
        var values = {};
        var valuesStr = [];

        if (_.isFunction(options)) {
            callback = options;
            options = {};
        }
        _.each(data, function(value, column){
            if (self.columns[column] && !self.primary[column]) {
                values[column] = data[column];
            }
        });

        _.each(values, function(value, column){
            valuesStr.push(format('%I = %L', column, value));
        });

        valuesStr = valuesStr.join(', ');

        var sql = self.queries.update.replace('{{columns}}', valuesStr);

        return self.db.query(sql, function(err){
            if (err) callback(err);
            else {
                callback(null, {update: 'success'});
                self.updatePersistent(function(err){
                    if (err) console.log('\nERROR: persistent fields update failed for ', self.name, 'with error:\n'+err);
                });
            }
        });
    };

    /**
     * Simple deletion by primary ids
     * @param ids
     * @param callback
     */
    del(ids, callback) {
        var self = this;
        var sql = self.queries.del;
        var queryIds = [];
        if (!_.isObject(ids)) {
            if (self.primary.length == 1) {
                var id = {};
                id[self.primary[0]] = ids;
                queryIds = id;
            } else callback({Error: "Incorrect delete id"});
        } else {
            var whereReplace = '';
            _.each(ids, function(value, column){
                whereReplace += ' AND ' + column + ' = %L';
                queryIds.push(value);
            });
            sql = self.queries.delWhere.replace('{{where}}', whereReplace);
        }
        return self.db.query(sql, queryIds, function(err){
            if (err) callback(err);
            else {
                callback(null, {delete: 'success'});
                self.updatePersistent(function(err){
                    if (err) console.log('\nERROR: persistent fields update failed for ', self.name, 'with error:\n'+err);
                });
            }
        });
    };

    /**
     * Return the number of records matching the request. Count all records by default
     * @param filters
     * @param callback
     */
    count(filters, callback) {
        if (_.isFunction(filters)) {
            callback = filters;
            filters = {};
        }
        var sql = self.db.injectFilters(self.queries.count, filters, self.filters);
        self.db.query(sql, function(err, count){
            if (err) callback(err);
            else callback(null, count[0]['cnt']);
        });
    };

    /**
     * Returns true if quer
     *
     * @param filters
     * @param callback
     */
    exists(filters, callback) {
        this.count(filters, function(err, count){
            callback(err, count > 0);
        });
    };

    /**
     * Shortcut for sql query to use in extended models
     *
     * @param {String} sql
     * @param {Object} params
     * @param {Function} callback
     * @returns {Object} Postgres query object*
     */
    query(sql, params, callback) {
        return this.db.query(sql, params, callback);
    };

    /**
     *  Shortcut for sql row query to use in extended models
     *
     * @param {String} sql
     * @param {Object} params
     * @param {Function} callback
     * @returns {Object} MariaDB query object
     */
    queryRow(sql, params, callback) {
        return this.db.queryRow(sql, params, callback)
    };

}

module.exports = Table;