const   _ = require('lodash'),
        _f = require('util').format,
        async = require('async'),
        format = require('pg-format');

const KEY_PRIMARY = 'PRIMARY KEY';
const KEY_FOREIGN = 'FOREIGN KEY';

const YES = 'YES';
const NO = 'NO';

const httpStatus = require('../lib/http_status_codes');

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
        this.db = db;
        this.defaultIds = [];
        this.numeric = new Set();
        this.nullable = new Set();
        this.primary = [];
        this.p = {};
        this.persistentUpdatesSuspended = 0;
        this.transform = {};

        this.PERSISTENT_MODE_SIMPLE = 'persistent_simple';
        this.PERSISTENT_MODE_ASSOC = 'persistent_assoc';
        this.PERSISTENT_MODE_ARRAY_BUNDLE = 'persistent_array';
        this.PERSISTENT_MODE_ARRAY_KEY = 'persistent_key';
        // this.PERSISTENT_MODE_TREE = 'persistent_tree';  TODO later
    }

    init(callback) {
        let self = this;
        async.waterfall([
            /**
             * Request columns info
             * @param {Function} next
             */
            function(next) {
                self.db.query(`
                                SELECT column_name, numeric_precision, is_nullable
                                FROM information_schema.columns
                                WHERE table_name = %L;`, self.name, next);
            },

            /**
             * Fill column types. Request constraints info
             * @param {Object[]} columns
             * @param {Function} next
             */
            function(columns, next) {
                _.each(columns, function(column) {
                    self.columns[column.column_name] = { name: column.column_name };
                    if (column.numeric_precision) {
                        self.numeric.add(column.column_name);
                        self.columns[column.column_name].numeric = true;
                    }
                    if (column.is_nullable == YES) {
                        self.nullable.add(column.column_name);
                        self.columns[column.column_name].nullable = true;
                    }
                });
                self.db.query(`
                                SELECT
                                    kcu.column_name, constraint_type
                                FROM
                                    information_schema.table_constraints AS tc
                                JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
                                JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
                                WHERE constraint_type IN (%L) AND tc.table_name=%L;`, [
                    [KEY_PRIMARY, KEY_FOREIGN], self.name
                ], next);
            },

            /**
             * Fill constraints
             * @param constraints
             * @param next
             */
            function(constraints, next) {
                var constraint_found = false;
                _.each(constraints, function(constraint) {
                    if (constraint.constraint_type == KEY_PRIMARY) {
                        self.columns[constraint.column_name].is_primary = true;
                        constraint_found = true;
                        self.primary.push(constraint.column_name);
                        self.defaultIds.push(`${constraint.column_name} = %L`);
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
                var defaultFiltersAPI = {};
                _.each(self.columns, function(props, column) {
                    var columnDefinition = `${self.aliasClause}${column}`;
                    defaultFilters[column] = ` ${columnDefinition} = %L`;
                    defaultFilters[`${column}s`] = ` ${columnDefinition} IN (%L)`;
                    defaultFilters[`not_${column}`] = ` ${columnDefinition} <> %L`;
                    defaultFilters[`not_${column}s`] = ` ${columnDefinition} NOT IN (%L)`;

                    defaultFiltersAPI[column] = {description: `Filter by ${column} equal to filter value`};
                    defaultFiltersAPI[`${column}s`] = {
                        description: `Filter by several values of ${column}`,
                        toArray: true
                    };
                    defaultFiltersAPI[`not_${column}`] = {description: `Filter by ${column} not equal to filter value`};
                    defaultFiltersAPI[`not_${column}s`] = {
                        description: `Reject filter results by several ${column} values`,
                        toArray: true
                    };

                    if (self.nullable.has(column)) {
                        defaultFilters[`null_${column}`] = ` ${columnDefinition} IS NULL`;
                        defaultFilters[`not_null_${column}`] = ` ${columnDefinition} IS NOT NULL`;
                        defaultFiltersAPI[`null_${column}`] = {description: `Filter by NULL ${column} entries`};
                        defaultFiltersAPI[`not_null_${column}`] = {description: `Filter by not NULL ${column} entries`};
                    }

                    if (self.numeric.has(column)) {
                        defaultFilters[`${column}_gt`] = ` ${columnDefinition} > %L`;
                        defaultFilters[`${column}_gte`] = ` ${columnDefinition} >= %L`;
                        defaultFilters[`${column}_lt`] = ` ${columnDefinition} < %L`;
                        defaultFilters[`${column}_lte`] = ` ${columnDefinition} <= %L`;
                        defaultFiltersAPI[`${column}_gt`] = {description: `Filter by ${column} greater than filter value`};
                        defaultFiltersAPI[`${column}_gte`] = {description: `Filter by ${column} greater than or equal to filter value`};
                        defaultFiltersAPI[`${column}_lt`] = {description: `Filter by ${column} less than filter value`};
                        defaultFiltersAPI[`${column}_lte`] = {description: `Filter by ${column} less than or equal to filter value`};

                    }
                });

                _.each(self.filters, function(filter, filter_key){
                    defaultFiltersAPI[filter_key] = {description: filter.description || `Custom ${filter_key} filter`};
                });

                let recursiveFilters = {};
                let basicFilters = {};
                _.each(defaultFilters, function(defaultFilter, key){
                    recursiveFilters[key] = {where: `AND (${defaultFilter} OR (${self.aliasClause}${key} IS NULL AND depth > 1))`};
                    basicFilters[key] = {where: `AND ${defaultFilter}`};
                });

                //Use class filters (if any) with default filters fallback
                self.filters = _.defaults(self.filters, basicFilters);
                self.filtersRecursive = _.defaults(self.filtersRecursive, recursiveFilters);
                self.filtersAPI = defaultFiltersAPI;

                var aliasDefinition = self.alias ? ` AS ${self.alias}` : '';

                //If the queries are already defined in model class, we use them instead of default queries
                self.queries = _.defaults(self.queries, {
                    row: `SELECT ${self.aliasClause}*{{select}} FROM "${self.name}"${aliasDefinition}{{join}} WHERE true{{whereClause}} {{where}} {{group}} {{having}} {{order}} LIMIT 1`,
                    list: `SELECT ${self.aliasClause}*{{select}} FROM "${self.name}"${aliasDefinition}{{join}} WHERE true{{where}} {{group}} {{having}} {{order}} {{limit}}`,
                    insert: `INSERT INTO "${self.name}"${aliasDefinition} ({{columns}}) VALUES ({{values}}){{returning}}`,
                    update: `UPDATE "${self.name}"${aliasDefinition} SET {{columns}} WHERE true ${self.defaultIds}`,
                    del: `DELETE FROM "${self.name}"${aliasDefinition} WHERE true ${self.defaultIds}`,
                    delWhere: `DELETE FROM "${self.name}"${aliasDefinition} WHERE true {{where}}`,
                    count: `SELECT COUNT(*) as cnt FROM "${self.name}"${aliasDefinition} WHERE true {{where}}`
                });

                self.persistentAssoc = self.persistentAssoc || {};

                next();
            }
        ], callback);

    };

    /**
     * Extend API object with default filters
     * @param {Object} filters Custom filters
     * @param {String[]} exclude list of columns for which default filters should not be applied
     * @return {Object}
     */
    defaultFilters(filters, exclude = []) {
        let self = this;
        let excludeFilters = [];
        _.each(exclude, function(excludeColumn){
            excludeFilters = _.concat(excludeFilters,
                    [excludeColumn, `${excludeColumn}s`, `not_${excludeColumn}`,
                    `not_${excludeColumn}s`, `null_${excludeColumn}`, `not_null_${excludeColumn}`]);
        });
        return _.defaultsDeep(filters, _.omit(self.filtersAPI, excludeFilters));
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
        let self = this;
        self.persistentUpdatesSuspended = Math.max(self.persistentUpdatesSuspended - 1, 0);
        console.log("Persistent lock for table '" + self.name + "' is set to " + self.persistentUpdatesSuspended);
        if (self.persistentUpdatesSuspended == 0 && !preventUpdating) {
            self.updatePersistent(function(err) {
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
    updatePersistent(callback) {
        var self = this;
        if ((!_.isEmpty(self.persistent) || !_.isEmpty(self.persistentAssoc)) && self.persistentUpdatesSuspended == 0) {
            self.suspendPersistentUpdates();
            async.waterfall([
                function(next) {
                    if (self.persistent) {
                        async.forEachOf(self.persistent, function(persistent, key, next_persistent) {
                            if (_.isFunction(persistent)) {
                                const func = persistent.bind(self);
                                func(function(err, data) {
                                    self.p[key] = data || false;
                                    self[key] = (function(key) {
                                        return function(id) {
                                            return self.p[key][id]
                                        };
                                    })(key);
                                    next_persistent(err);
                                });
                            } else {
                                if (_.isString(persistent)) {
                                    persistent = {
                                        'mode': self.PERSISTENT_MODE_ASSOC,
                                        'collect_by': persistent
                                    }
                                }
                                if (_.isObject(persistent)) {

                                    if (!_.isString(persistent.mode)) {
                                        console.log(`Incorrect persistent description for ${self.name}: ${key} (mode is missing or not a string):`);
                                        return next_persistent({error: `Incorrect persistent description for ${self.name}: ${key} (mode is missing or not a string):`, persistent: persistent});
                                    }

                                    async.waterfall([
                                        function(persistent_next_step) {
                                            self.list(persistent.filters || {}, persistent_next_step);
                                        },

                                        function(rows, persistent_next_step) {
                                            let pdata = {}; //persistent data
                                            switch (persistent.mode) {
                                                case self.PERSISTENT_MODE_SIMPLE:
                                                    pdata = rows;
                                                    break;
                                                case self.PERSISTENT_MODE_ASSOC:
                                                    if (!_.isString(persistent.collect_by)) {
                                                        console.log(`Incorrect persistent description for ${self.name}: ${key} (collect_by field is missing or not a string):`);
                                                        return persistent_next_step({error: `Incorrect persistent description for ${self.name}: ${key} (collect_by field is missing or not a string):`, persistent: persistent});
                                                    }
                                                    _.each(rows, function(row){
                                                        if (_.isUndefined(row[persistent.collect_by])) {
                                                            console.log(`WARNING: ${self.name}: ${key} has no entry for collect_by: ${persistent.collect_by}`);
                                                        } else {
                                                            pdata[row[persistent.collect_by]] = row;
                                                        }
                                                    });
                                                    break;
                                                case self.PERSISTENT_MODE_ARRAY_BUNDLE:
                                                    if (!_.isString(persistent.collect_by)) {
                                                        console.log(`Incorrect persistent description for ${self.name}: ${key} (collect_by field is missing or not a string):`);
                                                        return persistent_next_step({error: `Incorrect persistent description for ${self.name}: ${key} (collect_by field is missing or not a string):`, persistent: persistent});
                                                    }
                                                    _.each(rows, function(row){
                                                        if (_.isUndefined(row[persistent.collect_by])) {
                                                            console.log(`WARNING: ${self.name}: ${key} has no entry for collect_by: ${persistent.collect_by}`);
                                                        } else {
                                                            if (_.isUndefined(pdata[row[persistent.collect_by]])) pdata[row[persistent.collect_by]] = [];
                                                            pdata[row[persistent.collect_by]].push(row);
                                                        }
                                                    });
                                                    break;
                                                case self.PERSISTENT_MODE_ARRAY_KEY:
                                                    if (!_.isString(persistent.collect_by)) {
                                                        console.log(`Incorrect persistent description for ${self.name}: ${key} (collect_by field is missing or not a string):`);
                                                        return persistent_next_step({error: `Incorrect persistent description for ${self.name}: ${key} (collect_by field is missing or not a string):`, persistent: persistent});
                                                    }
                                                    if (!_.isString(persistent.collect_from)) {
                                                        console.log(`Incorrect persistent description for ${self.name}: ${key} (collect_from field is missing or not a string):`);
                                                        return persistent_next_step({error: `Incorrect persistent description for ${self.name}: ${key} (collect_from field is missing or not a string):`, persistent: persistent});
                                                    }
                                                    _.each(rows, function(row){
                                                        if (_.isUndefined(row[persistent.collect_by])) {
                                                            console.log(`WARNING: ${self.name}: ${key} has no entry for collect_by: ${persistent.collect_by}`);
                                                        } else {
                                                            if (_.isUndefined(row[persistent.collect_from])) {
                                                                console.log(`WARNING: ${self.name}: ${key} has no entry for collect_by: ${persistent.collect_from}`);
                                                            } else {
                                                                if (_.isUndefined(pdata[row[persistent.collect_by]])) pdata[row[persistent.collect_by]] = [];
                                                                pdata[row[persistent.collect_by]].push(row[persistent.collect_from]);
                                                            }
                                                        }
                                                    });
                                                    break;
                                                default:
                                                console.log(`Incorrect persistent description for ${self.name}: ${key} (unknown mode: "${persistent.mode}"):`);
                                                return persistent_next_step({error: `Incorrect persistent description for ${self.name}: ${key} (unknown mode: "${persistent.mode}"):`, persistent: persistent});
                                            }

                                            self.p[persistent.key || key] = pdata;
                                            if (!persistent.no_function) {
                                                self[persistent.getter_name || key] =
                                                    _.isFunction(persistent.getter) ?  persistent.getter :
                                                        (function (key) {
                                                            return function (id) {
                                                                return self.p[key][id]
                                                            };
                                                        })(key);
                                            }

                                            persistent_next_step();
                                        }
                                    ], next_persistent);

                                } else {
                                    console.log(`Incorrect persistent description for ${self.name}: ${key}:`, persistent);
                                    next_persistent({error: `Incorrect persistent description for ${self.name}: ${key}:`, persistent: persistent});
                                }
                            }
                        }, next)
                    } else next();
                }
            ], function(err) {
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
    static injectSort(sql, filters) {
        if (filters['order']) {
            var sort = filters['order'].split(',');
            if (_.isArray(sort)) {
                var direction = 'ASC';
                if (sort.indexOf('desc') > -1) {
                    direction = 'DESC';
                    delete sort[sort.indexOf('desc')];
                }
                if (sort.length) {
                    var fields = sort.join(", ");
                    sql = sql.replace('{{order}}', ` ORDER BY ${fields} ${direction}`);
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
    static injectLimit(sql, filters) {
        if (filters['limit']) {
            if (_.isArray(limit)) {
                for (var i = 0; i < limit.length; i++) {
                    limit[i] = parseInt(limit[i]);
                }
                if (limit.length == 1) sql = sql.replace('{{limit}}', ` LIMIT ${limit[0]}`);
                else if (limit.length == 2) sql = sql.replace('{{limit}}', ` LIMIT ${limit[0]} OFFSET ${limit[1]}`);
                else throw "Incorrect number of limit params (1 or 2 expected)"
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
    row(ids, filters, callback) {
        var self = this;
        if (_.isFunction(filters)) {
            callback = filters;
            filters = {};
        }
        if (!_.isFunction(callback)) throw new Error("Callback must be a function");

        var whereClause = "";
        if (!_.isObject(ids)) {
            whereClause = ` AND ${self.aliasClause}${self.primary[0]} = %L`;
        } else {
            var fields = [];
            var values = _.values(ids);
            _.each(ids, function(value, key) {
                if (self.columns[key]) {
                    fields.push(` AND ${self.aliasClause}${key} = %L`);
                } else {
                    if (self.filters[key]) {
                        filters[key] = value;
                    }
                }

            });
            ids = values;
            whereClause = fields.join(" ");
        }

        var columns = [];
        _.each(self.columns, function(column, name) {
            columns.push(`${name}`);
        });
        var sql = self.queries.row
            .replace('{{whereClause}}', whereClause);

        sql = self.db.injectFilters(sql, filters, self.filters);
        self.db.row(sql, ids, function(err, row) {
            if (err) return callback(err);
            if (_.isEmpty(row)) return callback({error: `No ${self.name} found for identifier(s) ${ids}`, code: httpStatus.NOT_FOUND , ids: ids, filters: filters});
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
            if (!_.isObject(filters) && !_.isArray(filters)) {
                console.log("WARNING. Invalid filters provided for " + self.name + ".list(). Object required");
                console.log(filters);
                filters = {};
            }
        }
        if (!_.isFunction(callback)) throw new Error("Callback must be a function");

        var columns = [];
        _.each(self.columns, function(column, name) {
            columns.push(`${self.name}.${name}`);
        });

        var sql = self.queries.list.replace('{{columns}}', columns.join(', '));
        return self.filteredQuery(sql, null, filters, callback);
    };


    static unfoldFilters(filters) {
        const unfold = {
            'eq': '%s',
            'neq': 'not_%s',
            'in': '%ss',
            'nin': '%ss',
            'null': 'null_%s',
            'nnull': 'not_null_%s',
            'gt': '%s_gt',
            'gte': '%s_gte',
            'lt': '%s_lt',
            'lte': '%s_lte'
        };
        _.each(filters, function(value, key) {
            if (_.isObject(value)) {
                _.each(value, function(folded_value, folded_key){
                    if (unfold[folded_key]) {
                        filters[_f(unfold[folded_key], key)] = folded_value;
                    }
                });
                delete filters[key];
            }
        });

        return filters;
    }

    /**
     * Perform custom filtered query
     * @param {String} sql
     * @param {Array} params
     * @param {Object} filters
     * @param {Function} callback
     */
    filteredQuery(sql, params = [], filters, callback) {
        var self = this;
        filters = Table.unfoldFilters(filters);
        sql = Table.injectLimit(sql, filters);
        sql = Table.injectSort(sql, filters);
        sql = self.db.injectFilters(sql, filters, self.filters);
        return self.db.query(sql, params, callback);
    }


    /**
     * Perform custom filtered query with recursive autofilters
     * @param {String} sql
     * @param {Array} params
     * @param {Object} filters
     * @param {Function} callback
     */
    filteredQueryRecursive(sql, params = [], filters, callback) {
        var self = this;
        filters = Table.unfoldFilters(filters);
        sql = Table.injectLimit(sql, filters);
        sql = Table.injectSort(sql, filters);
        sql = self.db.injectFilters(sql, filters, self.filtersRecursive);
        console.log(sql);
        return self.db.query(sql, params, callback)
    }

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
        options = _.defaults(options, self.preprocess);

        var insert_data = _.pick(data, _.keys(self.columns));

        insert_data = self._transform(insert_data, options);

        var sql = self.queries.insert
            .replace('{{columns}}', '%I')
            .replace('{{values}}', '%L');

        sql = self.injectReturning(sql);

        return self.db.row(sql, [_.keys(insert_data), _.values(insert_data)], function(err, res) {
            if (err) callback(err);
            else {
                callback(null, res);
                self.updatePersistent(function(err) {
                    if (err) console.log('\nERROR: persistent fields update failed for ', self.name, 'with error:\n' + err);
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

        if (!options) options = {};
        options = _.defaults(options, self.transform);

        var update_data = _.pick(data, _.difference(_.keys(self.columns), self.primary));

        update_data = self._transform(update_data, options);

        var where_data = _.values(_.pick(data, self.primary));

        _.each(update_data, function(value, column) {
            valuesStr.push(format('%I = %L', column, value));
        });

        var sql = self.queries.update.replace('{{columns}}', valuesStr.join(', '));

        return self.db.query(sql, where_data, function(err) {
            if (err) callback(err);
            else {
                callback(null, { update: 'success' });
                self.updatePersistent(function(err) {
                    if (err) console.log('\nERROR: persistent fields update failed for ', self.name, 'with error:\n' + err);
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
            } else callback({ Error: "Incorrect delete id" });
        } else {
            var whereReplace = '';
            _.each(ids, function(value, column) {
                whereReplace += ' AND ' + column + (_.isArray(value) ? ' IN (%L)' : ' = %L');
                queryIds.push(value);
            });
            sql = self.queries.delWhere.replace('{{where}}', whereReplace);
        }
        return self.db.query(sql, queryIds, function(err, res) {
            if (err) return callback(err);

            callback(null, { delete: 'success' });
            self.updatePersistent(function(err) {
                if (err) console.log('\nERROR: persistent fields update failed for ', self.name, 'with error:\n' + err);
            });

        });
    };

    /**
     * Return the number of records matching the request. Count all records by default
     * @param filters
     * @param callback
     */
    count(filters, callback) {
        var self = this;
        if (_.isFunction(filters)) {
            callback = filters;
            filters = {};
        }
        var sql = self.db.injectFilters(self.queries.count, filters, self.filters);
        self.db.query(sql, function(err, count) {
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
        if (_.isEmpty(filters)) return callback({error: `Empty request for ${this.name} entry existance check`, code: httpStatus.UNPROCESSABLE_ENTITY});
        this.count(filters, function(err, count) {
            callback(err, count > 0);
        });
    };

    /**
     * Transforms data according to crud options
     *
     * @param data
     * @param options
     */
    _transform(data, options) {
        if (_.isUndefined(options.transform) || !_.isArray(options.transform) || options.transform.length == 0) {
            return data;
        }
        _.each(options.transform, function(transform) {
            _.each(transform.fields, function(field) {
                if (!_.isUndefined(data[field])) {
                    data[field] = transform.fn(data[field]);
                }
            });
        });
        return data;
    }
}

module.exports = Table;
