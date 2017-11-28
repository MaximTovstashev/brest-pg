const _ = require('lodash'),
    async = require('async'),
    fs = require('fs'),
    path = require('path');

const Controller = require('../classes/controller');

const DEFAULT_CONTROLLERS_PATH = 'controllers';

class Ctrl {

    init (brest, callback) {

        this.controllers = {};

        const controllersPath = path.join(path.dirname(require.main.filename), brest.getSetting('controllers') || DEFAULT_CONTROLLERS_PATH);

        async.waterfall([
            /**
             * Checking if controllers path exists and accessible
             * @param {Function} next_step
             */
            next_step => {
                fs.stat(controllersPath, err => {
                    if (err) {
                        console.log(`[WARNING] can't access controllers path ${controllersPath}. Starting with no custom controllers support`);
                        this.customControllers = false;
                    } else {
                        this.customControllers = true;
                    }
                    next_step();
                });
            },

            next_step => {

                async.forEachOfSeries(brest.db.tables, (table, table_name, next_table) => {

                    async.waterfall([

                        /**
                         * Detect which class (generic or custom) to use with the controller
                         * @param controller_next_step
                         */
                        controller_next_step => {
                            if (this.customControllers) {
                                const customFile = path.join(controllersPath, `${table_name}.js`);
                                fs.stat(customFile, function(err) {
                                    if (err) { //No custom model
                                        controller_next_step(null, new Controller(table));
                                    } else { //Custom model exists
                                        const ControllerClass = require(customFile);
                                        controller_next_step(null, new ControllerClass(table));
                                    }
                                });
                            } else { //No custom models, use generic class
                                controller_next_step(null, new Controller(table));
                            }
                        },

                        (controller, controller_next_step) => {
                            this.controllers[table_name] = controller;
                            controller_next_step();
                        }

                    ], next_table);

                }, next_step);
            }

        ], err => {
            if (err) callback(err);
            this.initialized = true;
            callback();
        });

    }

    /**
     * Retrieve controller for the given table
     * @param table_name
     * @returns {Controller}
     */
    get (table_name) {
        return this.controllers[table_name];
    }

}

module.exports = Ctrl;