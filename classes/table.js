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
     * @param {String} table_name
     * @param {String} [alias]
     */
    constructor(db, table_name, alias) {
        this.name = table_name;
        this.alias = alias || '';
        this.aliasClause = alias ? `${alias}.` : '';
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
                        self.defaultIds.push(util.format('%s = %L', constraint.column_name));
                    }
                    if (constraint.constraint_type == KEY_FOREIGN) {
                        self.columns[constraint.column_name].is_foreign = true;
                        constraint_found = true;
                    }
                });
                if (!constraint_found) console.log(`[WARNING] No constraints on table ${self.name}`);
                self.defaultIds = self.defaultIds.length ? ` AND ${self.defaultIds.join(' AND ')}` : '';
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
                    var columnDefinition = `${self.aliasClause}${column}`;
                    defaultFilters[column] = {where: ` AND ${columnDefinition} = %L`};
                    defaultFilters[`${column}s`] = {where: ` AND ${columnDefinition} IN (%L)`};
                    defaultFilters[`not_${column}`] = {where: ` AND ${columnDefinition} <> %L`};
                    defaultFilters[`not_${column}s`] = {where: ` AND ${columnDefinition} NOT IN (%L)`};
                    defaultFilters[`null_${column}`] = {where: ` AND IS NULL ${columnDefinition}`};
                    defaultFilters[`not_null_${column}`] = {where: ` AND IS NOT NULL ${columnDefinition}`};
                });

                //Use class filters (if any) with default filters fallback
                self.filters = _.defaults(self.filters || {}, defaultFilters);

                var aliasDefinition = self.alias ? ` AS ${self.alias}` : '';

                //If the queries are already defined in model class, we use them instead of default queries
                self.queries = _.defaults(self.queries || {}, {
                    row: `SELECT *{{select}} FROM "${self.name}"${aliasDefinition}{{join}} WHERE true{{whereClause}} {{where}} {{group}} {{having}} {{order}} LIMIT 1`,
                    list: `SELECT *{{select}} FROM "${self.name}"${aliasDefinition}{{join}} WHERE true{{where}} {{group}} {{having}} {{order}} {{limit}}`,
                    insert: `INSERT INTO "${self.name}"${aliasDefinition} ({{columns}}) VALUES ({{values}}){{returning}}`,
                    update: `UPDATE "${self.name}"${aliasDefinition} SET {{columns}} WHERE true ${self.defaultIds}`,
                    del: `DELETE FROM "${self.name}"${aliasDefinition} WHERE true ${self.defaultIds}`,
                    delWhere: `DELETE FROM "${self.name}"${aliasDefinition} WHERE true {{where}}`,
                    count: `SELECT COUNT(*) as cnt FROM "${self.name}" WHERE true {{where}}`
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
        console.log("Persistent lock for table '" + this.name + "' is set to " + this.persistentUpdatesSuspended);
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
        if ((!_.isEmpty(self.persistent) || !_.isEmpty(self.persistentAssoc)) && self.persistentUpdatesSuspended == 0) {
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
    static injectSort(sql, filters){
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
    static injectLimit(sql, filters){
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
     * Inject RETURNING statement into request if it's required
     * @param {String} sql
     * @returns {string}
     */
    injectReturning(sql) {
        var returning = '';
        if (this.primary && this.primary.length) {
            returning = ' RETURNING ' + this.primary.join(', ');
        }
        return sql.replace('{{returning}}', returning);
    }

    /**
     * Select one row as an object
     * @param {int|String|Object} ids
     * @param {Object} [filters]
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
            whereClause = ` AND ${self.primary[0]} = %L`;
        } else {
            var fields = [];
            var values = _.values(ids);
            _.each(ids, function(value, key){
                fields.push(`${key} = %L`);
            });
            ids = values;
            whereClause = fields.join(" AND ");
        }

        var columns = [];
        _.each(self.columns, function(column, name){
            columns.push(`${name}`);
        });
        var sql = self.queries.row
            .replace('{{whereClause}}', whereClause);

        sql = self.db.injectFilters(sql, filters, self.filters);
        self.db.row(sql, ids, function(err, row){
            if (err) return callback(err);
            if (_.isEmpty(row)) return callback({error: `Entry not found in "${self.name}" table for identifier(s) ${ids}`, code: 404});
            callback(null, row);
        });
    };

    /**
     * Select data by query as an array of objects
     * @param {Object} filters
     * @param {Function} callback
     */
    list(filters, callback) {
        var self = this;
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
        sql = Table.injectLimit(sql, filters);
        sql = Table.injectSort(sql, filters);
        sql = self.db.injectFilters(sql, filters, self.filters);
        return self.db.query(sql, callback);
    };


    /**
     * Insert
     * @param {Object} data
     * @param {Object} [options]
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
            .replace('{{values}}', '%L');

        sql = self.injectReturning(sql);

        var q = self.db.row(sql, [_.keys(insert_data), _.values(insert_data)], function(err, res){
            if (err) callback(err);
            else {
                callback(null, res);
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
        var valuesStr = [];

        if (_.isFunction(options)) {
            callback = options;
            options = {};
        }

        var update_data = _.pick(data, _.difference(_.keys(self.columns), self.primary));
        var where_data = _.values(_.pick(data, self.primary));
        
        _.each(update_data, function(value, column){
            valuesStr.push(format('%I = %L', column, value));
        });

        var sql = self.queries.update.replace('{{columns}}', valuesStr.join(', '));

        return self.db.query(sql, where_data, function(err){
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
                queryIds = ids;
            } else callback({Error: "Incorrect delete id"});
        } else {
            var whereReplace = '';
            _.each(ids, function(value, column){
                whereReplace += ' AND ' + column + (_.isArray(value) ? ' IN (%L)' : ' = %L');
                queryIds.push(value);
            });
            sql = self.queries.delWhere.replace('{{where}}', whereReplace);
        }
        return self.db.query(sql, queryIds, function(err, res){
            if (err) return callback(err);

            callback(null, {delete: 'success'});
            self.updatePersistent(function(err){
                if (err) console.log('\nERROR: persistent fields update failed for ', self.name, 'with error:\n'+err);
            });

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
     * Returns true if query
     *
     * @param filters
     * @param callback
     */
    exists(filters, callback) {
        this.count(filters, function(err, count){
            callback(err, count > 0);
        });
    };
}

module.exports = Table;