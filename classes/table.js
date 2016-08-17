const   _ = require('lodash'),
        _f = require('util').format,
        async = require('async'),
        fs = require('fs'),
        format = require('pg-format'),
        path = require('path');

const KEY_PRIMARY = 'PRIMARY KEY';
const KEY_FOREIGN = 'FOREIGN KEY';

const YES = 'YES';
const NO = 'NO';

const BASIC_INJECTOR = 'basic';
const JS_EXTENTION = '.js';

const OPTIONAL_TAG_REGEXP = /({{[a-z]*}})/g;
const FORCED_TAG_REGEXP = /{%([a-z]*)%}/g;
const ANY_TAG_REGEXP = /({[{|%][a-z]*?[}|%]})/g;

const FORCED_TAG_REGEXP_POSITION = 1;

const httpStatus = require('../lib/http_status_codes');

const FOLDED_CLAUSES = {
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

const NON_FOLDABLE_FILTERS = ['update'];
const NON_GROUPABLE_FILTERS = ['where'];

class Table {

    /**
     *
     * @param {DB} db
     * @param {String} table_name
     * @param {String} [alias]
     */
    constructor(db, table_name, alias) {
        /**
         * Database table name
         * @type {String}
         */
        this.name = table_name;
        /**
         * Table name shortcut like 'u' in `SELECT u.* FROM user AS u`
         * @type {String}
         */
        this.alias = alias || '';
        /**
         * Query-ready string with table name alias.
         * @type {string}
         */
        this.aliasClause = alias ? `${alias}.` : '';
        /**
         * Object with table names as keys and properties as values
         * @type {Object}
         */
        this.columns = {};
        /**
         * Db object pointer
         * @type {DB}
         */
        this.db = db;
        /**
         * Set of numeric columns names
         * @type {Set}
         */
        this.numeric = new Set();
        /**
         * Set of nullable columns names
         * @type {Set}
         */
        this.nullable = new Set();

        this.falseIfEmpty = new Set();
        this.trueIfEmpty = new Set();
        /**
         * Array of the columns with primary keys
         * @type {Array}
         */
        this.primary = [];
        /**
         * Array of columns not involved in primary keys
         * @type {Array}
         */
        this.non_primary = [];
        /**
         * Persistant data storage. Please, read-only outside of the persistent update logic
         * @type {Object}
         */
        this.p = {};
        /**
         * Persistent update status flag. Updatable if zero. In progress, if non-zero.
         * @type {Number}
         */
        this.persistentUpdatesSuspended = 0;
        /**
         * Array of preprocessors. See manual
         * @type {Array}
         */
        this.$preprocess = [];
        /**
         * Ceiling for the "limit" clause.
         * @type {number}
         */
        this.topLimit = 100;

        /**
         * Injectors
         * @type {Proxy}
         */
        this.injectors = new Proxy({}, Table.injectorsHandler());

        this.PERSISTENT_MODE_SIMPLE = 'persistent_simple';
        this.PERSISTENT_MODE_ASSOC = 'persistent_assoc';
        this.PERSISTENT_MODE_ARRAY_BUNDLE = 'persistent_array';
        this.PERSISTENT_MODE_ARRAY_KEY = 'persistent_key';
        const persistentPath = path.join(path.dirname(module.filename), '..', 'persistent');
        this.persistentHandlers = {
            [this.PERSISTENT_MODE_SIMPLE]: require(path.join(persistentPath, 'simple')),
            [this.PERSISTENT_MODE_ASSOC]: require(path.join(persistentPath, 'assoc')),
            [this.PERSISTENT_MODE_ARRAY_BUNDLE]: require(path.join(persistentPath, 'array')),
            [this.PERSISTENT_MODE_ARRAY_KEY]: require(path.join(persistentPath, 'key'))
        };
        // this.PERSISTENT_MODE_TREE = 'persistent_tree';  TODO later
    }

    /**
     * Return injectors handler
     * @return {Object}
     */
    static injectorsHandler() {
        return {
            get(target, key) {
                return key in target ? target[key] : target[BASIC_INJECTOR];
            }
        }
    }

    init(callback) {

        async.waterfall([
            /**
             * Request columns info
             * @param {Function} next
             */
            (next) => {
                this.db.query(`
                                SELECT column_name, numeric_precision, is_nullable
                                FROM information_schema.columns
                                WHERE table_name = %L;`, this.name, next);
            },

            /**
             * Fill column types. Request constraints info
             * @param {Object[]} columns
             * @param {Function} next
             */
            (columns, next) => {
                _.each(columns, (column) => {
                    this.columns[column.column_name] = { name: column.column_name };
                    if (column.numeric_precision) {
                        this.numeric.add(column.column_name);
                        this.columns[column.column_name].numeric = true;
                    }
                    if (column.is_nullable == YES) {
                        this.nullable.add(column.column_name);
                        this.columns[column.column_name].nullable = true;
                    }
                });
                this.db.query(`
                                SELECT
                                    kcu.column_name, constraint_type
                                FROM
                                    information_schema.table_constraints AS tc
                                JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name
                                JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name
                                WHERE constraint_type IN (%L) AND tc.table_name=%L;`, [
                    [KEY_PRIMARY, KEY_FOREIGN], this.name
                ], next);
            },

            /**
             * Fill constraints
             * @param constraints
             * @param next
             */
            (constraints, next) => {
                var constraint_found = false;
                _.each(constraints, (constraint) => {
                    if (_.isNil(this.columns[constraint.column_name])) console.log(`[ERROR] Column ${constraint.column_name} of table ${this.name} does not exist, but there is a ${constraint.constraint_type} constraint defined`);
                    if (constraint.constraint_type == KEY_PRIMARY) {
                        this.columns[constraint.column_name].is_primary = true;
                        constraint_found = true;
                        this.primary.push(constraint.column_name);
                    }
                    if (constraint.constraint_type == KEY_FOREIGN) {
                        this.columns[constraint.column_name].is_foreign = true;
                        constraint_found = true;
                    }
                });
                if (!constraint_found) console.log(`[WARNING] No constraints on table ${this.name}`);
                next();
            },

            /**
             * Initialise filters and queries
             * @param next
             */
            (next) => {
                //Set default filters for all table columns
                const defaultFilters = {};
                const defaultFiltersAPI = {};
                this.non_primary = [];

                _.each(this.columns, (props, column) => {
                    if (this.primary.indexOf(column) === -1) {
                        this.non_primary.push(column);
                    }

                    var columnDefinition = `${this.aliasClause}${column}`;
                    defaultFilters[column] = ` ${columnDefinition} = %L`;
                    defaultFilters[`${column}s`] = ` ${columnDefinition} IN (%L)`;
                    this.falseIfEmpty.add(`${column}s`);
                    defaultFilters[`not_${column}`] = ` ${columnDefinition} <> %L`;
                    defaultFilters[`not_${column}s`] = ` ${columnDefinition} NOT IN (%L)`;
                    this.trueIfEmpty.add(`not_${column}s`);

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

                    if (this.nullable.has(column)) {
                        defaultFilters[`null_${column}`] = ` ${columnDefinition} IS NULL`;
                        defaultFilters[`not_null_${column}`] = ` ${columnDefinition} IS NOT NULL`;
                        defaultFiltersAPI[`null_${column}`] = {description: `Filter by NULL ${column} entries`};
                        defaultFiltersAPI[`not_null_${column}`] = {description: `Filter by not NULL ${column} entries`};
                    }

                    if (this.numeric.has(column)) {
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

                _.each(this.filters, (filter, filter_key) => {
                    defaultFiltersAPI[filter_key] = {description: filter.description || `Custom ${filter_key} filter`};
                });

                let recursiveFilters = {};
                let basicFilters = {};
                _.each(defaultFilters, (defaultFilter, key) => {
                    recursiveFilters[key] = {where: `(${defaultFilter} OR (${this.aliasClause}${key} IS NULL AND depth > 1))`};
                    basicFilters[key] = {where: defaultFilter};
                });

                basicFilters['columns'] = {columns: '%I'};
                basicFilters['values'] = {values: '%L'};
                basicFilters['update'] = {update: '%TO BE REPLACED BY INJECTOR%'};
                basicFilters['limit'] = {limit: '%TO BE REPLACED BY INJECTOR%'};
                basicFilters['order'] = {order: '%TO BE REPLACED BY INJECTOR%'};

                //Use class filters (if any) with default filters fallback
                this.filters = _.defaults(this.filters, basicFilters);
                this.filtersRecursive = _.defaults(this.filtersRecursive, recursiveFilters);
                this.filtersAPI = defaultFiltersAPI;

                var aliasDefinition = this.alias ? ` AS ${this.alias}` : '';

                //If the queries are already defined in model class, we use them instead of default queries
                this.queries = _.defaults(this.queries, {
                    select: `SELECT {%distinct%} ${this.aliasClause}*{{select}} FROM "${this.name}"${aliasDefinition}{{join}} WHERE true{{where}} {{group}} {{having}} {{order}} {{limit}}`,
                    insert: `INSERT INTO "${this.name}"${aliasDefinition} ({{columns}}) VALUES ({{values}}){%conflict%}{%returning%}`,
                    update: `UPDATE "${this.name}"${aliasDefinition} SET {{update}} WHERE true {{where}} {{limit}}`,
                    del: `DELETE FROM "${this.name}"${aliasDefinition} WHERE true {{where}} {%returning%}`,
                    count: `SELECT COUNT(*) as cnt FROM "${this.name}"${aliasDefinition} WHERE true {{where}}`
                });

                this.persistentAssoc = this.persistentAssoc || {};

                next();
            },
            (next) => {
                const injectorsPath = path.join(path.dirname(module.filename), '..', 'injectors');
                fs.readdir(injectorsPath, (err, injectors) => {
                    if (err) return next(err);
                    _.each(injectors, (injector) => {
                        if (path.extname(injector) == JS_EXTENTION) {
                            const InjectorClass = require(path.join(injectorsPath, injector));
                            this.injectors[path.basename(injector, JS_EXTENTION)] = new InjectorClass(this);
                        }
                    });
                    next();
                });
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
        let excludeFilters = [];
        _.each(exclude, function(excludeColumn){
            excludeFilters = _.concat(excludeFilters,
                    [excludeColumn, `${excludeColumn}s`, `not_${excludeColumn}`,
                    `not_${excludeColumn}s`, `null_${excludeColumn}`, `not_null_${excludeColumn}`]);
        });
        return _.defaultsDeep(filters, _.omit(this.filtersAPI, excludeFilters));
    };

    /**
     * Unfold filter shortcuts into full filters
     * @param filters
     * @return {*}
     */
    static unfoldFilters(filters) {
        if (_.isArray(filters)) return _.map(filters, Table.unfoldFilters);

        _.each(filters, function(value, key) {
            if (NON_FOLDABLE_FILTERS.indexOf(key) == -1 && _.isObject(value) && !_.isArray(value)) {
                _.each(value, function(folded_value, folded_key){
                    if (FOLDED_CLAUSES[folded_key]) {
                        filters[_f(FOLDED_CLAUSES[folded_key], key)] = folded_value;
                    }
                });
                delete filters[key];
            }
        });

        return filters;
    }

    /**
     * Prepare injections to be inserted into the query template
     * @param filters
     * @return {{}}
     */
    normalizeInjections(filters) {
        //Perform additional normalization if we have OR-object
        if (_.isArray(filters)) {
            const preNormalizedInjections =  _.map(filters, (filter) => this.normalizeInjections(filter));
            const normalizedInjections = {};
            _.each(preNormalizedInjections, function(injectionBlock){
                 _.each(injectionBlock, function(injection, key) {
                    if (NON_GROUPABLE_FILTERS.indexOf(key) == -1) {
                        normalizedInjections[key] = _.defaults(normalizedInjections[key], injection);
                    } else {
                        if (!normalizedInjections[key]) normalizedInjections[key] = [];
                        normalizedInjections[key].push(injection);
                    }
                 });
            });
            return normalizedInjections;
        }

        const actualFiltersKeys = _.intersection(_.keys(filters, _.keys(this.filters)));

        const normalizedInjections = {};

        let filtersToUse = this.filters;
        if (filters.$recursive) filtersToUse = _.defaults(this.filtersRecursive, filtersToUse);

        _.each(_.pick(filtersToUse, actualFiltersKeys), (injections, filter)=>{
            _.each(injections, (injection, tag) => {
                if (_.isUndefined(normalizedInjections[tag])) normalizedInjections[tag] = {};
                normalizedInjections[tag][filter] = this.injectors[tag].format(injection, filters[filter], filter);
            });
        });
        return normalizedInjections;
    }

    /**
     * Compose query out of provided filters and query template
     * @param query
     * @param filters
     * @return {string|XML|void|*}
     */
    composeQuery(query, filters) {

        filters = Table.unfoldFilters(filters);

        const normalizedInjections = this.normalizeInjections(filters);
        const queryTags = query.match(OPTIONAL_TAG_REGEXP);
        const appliableInjections = _.pickBy(normalizedInjections, (value, key) => queryTags.indexOf(`{{${key}}}`) > -1);

        _.each(appliableInjections, (injection, tag) => {
            query = this.injectors[tag].inject(query, appliableInjections[tag], filters, tag);
        });

        const forcedTags = [];
        let match;
        while (match = FORCED_TAG_REGEXP.exec(query)) {
            forcedTags.push(match[FORCED_TAG_REGEXP_POSITION]);
        }

        _.each(forcedTags, (tag) => {
            query = this.injectors[tag].force(query, filters, tag);
        });

        // Remove unused tags
        query = query.replace(ANY_TAG_REGEXP,"");

        return query;
    };

    /**
     * Perform custom filtered query
     * @param {String} query
     * @param {Array} params
     * @param {Object} [_filters]
     * @param {Function} callback
     */
    filteredQuery(query, params = [], _filters, callback) {
        if (_.isFunction(_filters)) {
            callback = _filters;
            _filters = {};
        }
        let filters = _.cloneDeep(_filters);
        query = format(query, ...params);
        return this.db.query(this.composeQuery(this.queries.select, filters), callback);
    }

    /**
     * Select one row as an object
     * @param {int|String|Object} [_filters]
     * @param {Function} callback
     */
    row(_filters, callback) {
        if (_.isFunction(_filters)) {
            callback = _filters;
            _filters = {};
        }
        let filters = _.cloneDeep(_filters);
        if (!_.isFunction(callback)) throw new Error("Callback must be a function");
        if (!_.isObject(filters)) filters = {[this.primary[0]]: filters};
        filters.limit = [1];

        this.db.row(this.composeQuery(this.queries.select, filters),
            (err, result) => {
                if (err) return callback(err);
                if (_.isEmpty(result) && !filters.$allowEmpty) return callback({error: `No ${this.name} found for identifier(s) ${filters}`, code: httpStatus.NOT_FOUND , filters: filters});
                callback(null, result);
            });
    };

    /**
     * Select data by query as an array of objects
     * @param {Object} _filters
     * @param {Function} callback
     */
    list(_filters, callback) {
        if (_.isFunction(_filters)) {
            callback = _filters;
            _filters = {};
        }
        let filters = _.cloneDeep(_filters);
        if (!_.isFunction(callback)) throw new Error("Callback must be a function");
        return this.db.query(this.composeQuery(this.queries.select, filters), callback);
    };


    /**
     * Insert
     * @param {Object} data
     * @param {Object} [_filters]
     * @param {Function} callback
     */
    insert(data, _filters, callback) {
        if (_.isFunction(_filters)) {
            callback = _filters;
            _filters = {};
        }
        let filters = _.cloneDeep(_filters);
        const relatedData = _.pick(data, _.keys(this.columns));
        filters = _.defaults(filters, {
            columns: _.keys(relatedData),
            values: _.values(this._preprocess(relatedData, _.concat(filters.$preprocess || [], this.$preprocess)))
        });

        return this.db.row(this.composeQuery(this.queries.insert, filters), (err, res) => {
            if (err) return callback(err);
            callback(null, res);
            this.updatePersistent(this.persistentUpdateCallback);
        });
    };

    /**
     * Update
     * @param {Object} data
     * @param {Object} [_filters]
     * @param {Function} callback
     */
    update(data, _filters, callback) {
        if (_.isFunction(_filters)) {
            callback = _filters;
            _filters = {};
        }
        let filters = _.cloneDeep(_filters);
        data = this._preprocess(data, _.concat(filters.$preprocess || [], this.$preprocess));

        if (_.isString(filters.$update_by)) filters.$update_by = [filters.$update_by];
        const update_by_columns = filters.$update_by || this.primary;
        const update_data = _.pick(data, _.difference(_.keys(this.columns), update_by_columns));

        if (_.isEmpty(update_data)) return callback(null, {update: 'success', warning: 'Empty update object'});

        if (_.isArray(filters)) {
            filters.push(_.pick(data, update_by_columns));
            filters.push({update: update_data})
        }
        else {
            filters = _.defaults(filters, _.pick(data, update_by_columns));
            filters.update = update_data;
        }

        return this.db.query(this.composeQuery(this.queries.update, filters), (err) => {
            if (err) return callback(err);
            callback(null, {update: 'success'});
            this.updatePersistent(this.persistentUpdateCallback);
        });
    };

    /**
     * Simple deletion by primary ids
     * @param {Object} _filters
     * @param {Function} callback
     */
    del(_filters, callback) {
        if (_.isFunction(_filters)) {
            callback = _filters;
            _filters = {};
        }
        let filters = _.cloneDeep(_filters);

        if (!_.isFunction(callback)) throw new Error("Callback must be a function");
        if (_.isEmpty(filters)) return callback({error: "Can't delete with empty filters"});
        if (!_.isObject(filters)) filters = {[this.primary[0]]: filters};

        if (_.isEmpty(filters)) callback({error: 'Deletion with empty filter must be forced', code: httpStatus.UNPROCESSABLE_ENTITY});

        return this.db.row(this.composeQuery(this.queries.del, filters), (err, res) => {
            if (err) return callback(err);
            callback(null, res);
            this.updatePersistent(this.persistentUpdateCallback);
        });
    };

    /**
     * Return the number of records matching the request. Count all records by default
     * @param _filters
     * @param callback
     */
    count(_filters, callback) {
        if (_.isFunction(_filters)) {
            callback = _filters;
            _filters = {};
        }
        let filters = _.cloneDeep(_filters);

        this.db.query(this.composeQuery(this.queries.count, filters), (err, count) => {
            if (err) return callback(err);
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
     * @param preprocessors
     */
    _preprocess(data, preprocessors) {
        if (!_.isObject(preprocessors) || preprocessors.length == 0) {
            return data;
        }
        _.each(preprocessors, function(preprocessor) {
            _.each(preprocessor.fields, function(field) {
                if (!_.isUndefined(data[field])) {
                    data[field] = preprocessor.fn(data[field]);
                }
            });
        });
        return data;
    }

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
        const self = this;
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

                                            if (_.isFunction(self.persistentHandlers[persistent.mode])) {
                                                pdata = self.persistentHandlers[persistent.mode](persistent, rows, self);
                                            }  else {
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

    persistentUpdateCallback(err) {
        if (err) console.log('\nERROR: persistent fields update failed for ', this.name, 'with error:\n' + err);
    }

}

module.exports = Table;
