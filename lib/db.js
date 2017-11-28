'use strict';

const   async = require('async'),
        fs = require('fs'),
        format = require('pg-format'),
        inherits = require('util').inherits,
        path = require('path'),
        {Pool} = require('pg').native,
        _ = require('lodash');

const Table = require('../classes/table');

const required_settings = ['user', 'password', 'host', 'database'];
const DEFAULT_MODELS_PATH = 'models';

/**
 * Create a new database instance
 *
 * @param settings
 * @constructor
 */
class DB {

    /**
     * Prepare the connection string for the PG connection, and create table objects
     * The connections are actually made with each query from node-postgres connections pool
     * to prevent single-connection bottleneck
     */
    connect(brest, settings, callback) {

        const missing_settings = _.difference(required_settings, _.keys(settings));
        if (missing_settings.length > 0) {
          return callback({error: 'Brest-pg missing settings', missing: missing_settings});
        }
        this.settings = settings;
        this.tables = {};
        this.pg = new Pool(this.settings);

        this.pg.on('error', err => {
          brest.emit('error', err);
        });

        const modelPath = path.join(path.dirname(require.main.filename), this.settings.models || DEFAULT_MODELS_PATH);

        async.waterfall([

            /**
             * @param {Function} next
             */
            next => {
                fs.stat(modelPath, err => {
                    if (err) {
                        console.log(`[WARNING] can't access models path ${modelPath}. Starting with no custom model support`);
                        this.customModels = false;
                    } else {
                        this.customModels = true;
                    }
                    next();
                });
            },

          /**
           * @param {Function} next(err, tables)
           */
          next => {
                this.query(`
                            SELECT table_name
                            FROM information_schema.tables
                            WHERE table_catalog = %L AND table_schema NOT IN ('pg_catalog', 'information_schema')
                            ORDER BY table_schema, table_name;`, settings.database, next);
            },

            /**
             * Initializing table models
             * @param {Array} tables
             * @param {Function} next
             */
            (tables, next) => {
                async.eachSeries(tables, (table, next_table) => {

                    const table_name = table.table_name;

                    async.waterfall([

                      table_next => {
                          if (this.customModels) {
                              const customFile = path.join(modelPath, `${table_name}.js`);
                              fs.stat(customFile, err => {
                                  if (err) { //No custom model
                                      table_next(null, Table);
                                  } else { //Custom model exists
                                      table_next(null, require(customFile));
                                  }
                              });
                          } else { //No custom models, use generic class
                              table_next(null, Table);
                          }
                      },

                      (TableModel, table_next) => {
                            this.tables[table_name] = new TableModel(this, table_name);
                            this.tables[table_name].init(table_next);
                        },

                      table_next => {
                          this.tables[table_name].updatePersistent(table_next);
                      }

                    ], next_table);

                }, (err) => next(err));
            }

        ], callback);
    }

    /**
     * Perform singular query with optional params array.
     * Use (http://www.postgresql.org/docs/9.3/static/functions-string.html#FUNCTIONS-STRING-FORMAT) to format
     * the query string
     * @param {String} query
     * @param {Array} [params]
     * @param {Function} callback
     */
    query(query, params, callback) {

        if (_.isFunction(params)) {
            callback = params;
            params = [];
        }

        this.pg.connect((err, client, release) => {
            if (err) {
                return callback(err);
            }

            const results = [];

            if (!_.isArray(params)) params = [params];
            const formatted_query = format(query, ...params);
            if (this.settings.log) console.log(`\n[QUERY]: \n${formatted_query}`);

            client.query(formatted_query, (err, res) => {
              release();
              callback(err, res.rows);
            });

            return {
              raw_query: query,
              formatted_query,
              params
            }
        });
    }

    /**
     * Query a single row
     * @param {String} query
     * @param {Array} params
     * @param {Function} callback
     */
    row (query, params, callback) {
        if (_.isFunction(params)) {
            callback = params;
            params = [];
        }

        return this.query(query, params, (err, res) => {
            if (err) return callback(err);
            callback(null, res[0]);
        });
    }

    /**
     * Inject filters into the formatted query
     * @param {String} query
     * @param {Object} filters
     * @param {Object} filterQueries
     * @returns {String}
     */
    injectFilters (query, filters, filterQueries) {
        const injections = {};
        const used = {};

        _.each(filters, (value, filter) => {

            if (filterQueries[filter]) {

                //Preprocess value if needed
                if (filterQueries[filter]._pre) {
                    value = filterQueries[filter]._pre(value);
                }

                _.each(filterQueries[filter], (injection, place) => {

                    if (place[0] !== "_"){ //We use underscored keys for handlers

                        if (!used[place]) used[place] = [];

                        if (used[place].indexOf(injection) === -1){
                            used[place].push(injection);

                            value = [value];
                            const formatted_injection = format(injection, ...value);
                            if (injections[place]) injections[place] += ` ${formatted_injection}`;
                            else injections[place] = formatted_injection;
                        }
                    }
                });

            }
        });

        _.each(injections, (injection, key) => {
            query = query.replace("{{"+key+"}}", " "+injection);
        });

        return query.replace(/({{.*?}})*/g,"");
    }

    /**
     * Return table object for the given table (if exists)
     * @param table
     * @returns {*}
     */
    table (table) {
        if (_.isEmpty(this.tables[table])) throw new Error(`Attempted to request non-existing table "${table}"`);
        return this.tables[table];
    }

}

module.exports = DB;
