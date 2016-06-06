'use strict';

var async = require('async'),
    EventEmitter = require('events').EventEmitter,
    fs = require('fs'),
    format = require('pg-format'),
    inherits = require('util').inherits,
    path = require('path'),
    pg = require('pg').native,
    _ = require('lodash');

var Table = require('../classes/table');

const required_settings = ['user', 'password', 'host', 'db'];
const DEFAULT_MODELS_PATH = 'models';

/**
 * Create a new database instance
 *
 * @param settings
 * @constructor
 */
var DB = function(settings) {
    var self = this;
    var missing_settings = _.difference(required_settings, _.keys(settings));
    if (missing_settings.length > 0) {
        self.emit('error', {'error': 'Brest-pg missing settings', 'missing': missing_settings});
        return;
    }
    self.settings = settings;
    self.tables = {};

    /**
     * Prepare the connection string for the PG connection, and create table objects
     * The connections are actually made with each query from node-postgres connections pool
     * to prevent single-connection bottleneck
     */
    self.connect  = function(){
        self.conString = `postgres://${settings.user}:${settings.password}@${settings.host}/${settings.db}`;
        var modelPath = path.join(path.dirname(require.main.filename), self.settings.models || DEFAULT_MODELS_PATH);

        async.waterfall([

            /**
             * Checking if model path exists and accessible
             * @param {Function} next
             */
            function(next) {
                fs.stat(modelPath, function(err) {
                    if (err) {
                        console.log(`[WARNING] can't access models path ${modelPath}. Starting with no custom model support`);
                        self.customModels = false;
                    } else {
                        self.customModels = true;
                    }
                    next();
                });
            },

            /**
             * Requesting tables
             * @param next
             */
            function(next) {
                self.query(`
                            SELECT table_name
                            FROM information_schema.tables
                            WHERE table_catalog = %L AND table_schema NOT IN ('pg_catalog', 'information_schema')
                            ORDER BY table_schema, table_name;`, settings.db, next);
            },

            /**
             * Initializing table models
             * @param {Array} tables
             * @param {Function} next
             */
            function(tables, next) {
                async.eachSeries(tables, function(table, next_table){

                    var table_name = table.table_name;

                    async.waterfall([

                        /**
                         * Detect which class (generic or custom) to use with the table
                         * @param table_next_step
                         */
                        function(table_next_step) {
                            if (self.customModels) {
                                var customFile = path.join(modelPath, `${table_name}.js`);
                                fs.stat(customFile, function(err) {
                                    if (err) { //No custom model
                                        table_next_step(null, Table);
                                    } else { //Custom model exists
                                        table_next_step(null, require(customFile));
                                    }
                                });
                            } else { //No custom models, use generic class
                                table_next_step(null, Table);
                            }
                        },

                        /**
                         * Initialize model object
                         * @param TableModel
                         * @param table_next_step
                         */
                        function(TableModel, table_next_step) {
                            self.tables[table_name] = new TableModel(self, table_name);
                            self.tables[table_name].init(table_next_step);
                        },

                        function(table_next_step) {
                            self.tables[table_name].updatePersistent(table_next_step);
                        }

                    ], next_table);

                }, next);
            }

        ], function(err){
            if (err) return self.emit('error', err);
            self.emit('ready')
        });
    };

    /**
     * Perform singular query with optional params array.
     * Use (http://www.postgresql.org/docs/9.3/static/functions-string.html#FUNCTIONS-STRING-FORMAT) to format
     * the query string
     * @param {String} query
     * @param {Array} params
     * @param {Function} callback
     */
    this.query = function(query, params, callback){

        if (_.isFunction(params)) {
            callback = params;
            params = [];
        }

        pg.connect(self.conString, function(err, client, done){
            if (err) {
                return self.emit('error', err);
            }

            var results = [];

            if (!_.isArray(params)) params = [params];
            var formatted_query = format(query, ...params);
            if (self.settings.log) console.log(`\n[QUERY]: \n${formatted_query}`);
            var q = client.query(formatted_query);

            q.on('row', function(row) {
                results.push(row);
            });

            q.on('error', function(err) {
                callback(err);
            });

            q.on('end', function() {
                done();
                callback(null, results);
            });

            return q;
        });
    };

    /**
     * Query a single row
     * @param {String} query
     * @param {Array} params
     * @param {Function} callback
     */
    this.row = function(query, params, callback){
        return self.query(query, params, function(err, res){
            if (err) callback(err);
            else callback(null, res[0]);
        });
    };

    /**
     * Inject filters into the formatted query
     * @param {String} query
     * @param {Object} filters
     * @param {Object} filterQueries
     * @returns {String}
     */
    this.injectFilters = function(query, filters, filterQueries) {
        var self = this;
        var injections = {};
        var used = {};

        _.each(filters, function(value, filter){

            if (filterQueries[filter]) {

                //Preprocess value if needed
                if (filterQueries[filter]._pre) {
                    value = filterQueries[filter]._pre(value);
                }

                _.each(filterQueries[filter], function(injection, place){

                    if (place[0] != "_"){ //We use underscored keys for handlers

                        if (!used[place]) used[place] = [];

                        if (used[place].indexOf(injection) === -1){
                            used[place].push(injection);

                            if (!_.isArray(value)) value = [value];
                            var formatted_injection = format(injection, ...value);
                            if (injections[place]) injections[place] += ` ${formatted_injection}`;
                            else injections[place] = formatted_injection;
                        }
                    }
                });

            }
        });

        _.each(injections, function(injection, key){
            query = query.replace("{{"+key+"}}", " "+injection);
        });

        return query.replace(/({{.*?}})*/g,"");
    };

    /**
     * Return table object for the given table (if exists)
     * @param table
     * @returns {*}
     */
    this.table = (table) => {
        if (_.isEmpty(self.tables[table])) throw new Error(`Attempted to request non-existing table "${table}"`);
        return self.tables[table];
    };

    self.connect();
};

inherits(DB, EventEmitter);

module.exports = DB;
