var _ = require('lodash'),
    async = require('async'),
    fs = require('fs'),
    path = require('path'),
    util = require('util');

var Controller = require('../classes/controller');

const DEFAULT_CONTROLLERS_PATH = 'controllers';

var Ctrl = function() {
    var self = this;

    self.init = function(brest, callback) {

        self.controllers = {};

        var controllersPath = path.join(path.dirname(require.main.filename), brest.getSetting('controllers') || DEFAULT_CONTROLLERS_PATH);

        async.waterfall([
            /**
             * Checking if controllers path exists and accessible
             * @param {Function} next_step
             */
            function(next_step) {
                fs.stat(controllersPath, function(err) {
                    if (err) {
                        console.log(`[WARNING] can't access controllers path ${controllersPath}. Starting with no custom controllers support`);
                        self.customControllers = false;
                    } else {
                        self.customControllers = true;
                    }
                    next_step();
                });
            },

            function(next_step) {


                async.forEachOfSeries(brest.db.tables, function(table, table_name, next_table) {

                    async.waterfall([

                        /**
                         * Detect which class (generic or custom) to use with the controller
                         * @param controller_next_step
                         */
                        function(controller_next_step) {
                            if (self.customControllers) {
                                var customFile = path.join(controllersPath, `${table_name}.js`);
                                fs.stat(customFile, function(err) {
                                    if (err) { //No custom model
                                        controller_next_step(null, new Controller(table));
                                    } else { //Custom model exists
                                        var ControllerClass = require(customFile);
                                        controller_next_step(null, new ControllerClass(table));
                                    }
                                });
                            } else { //No custom models, use generic class
                                controller_next_step(null, new Controller(table));
                            }
                        },

                        function(controller, controller_next_step) {
                            self.controllers[table_name] = controller;
                            controller_next_step();
                        }

                    ], next_table);

                }, next_step);
            }

        ], function(err){
            if (err) callback(err);
            self.initialized = true;
            callback();
        });

    };

    self.get = function(table_name) {
        return self.controllers[table_name];
    };

};

module.exports = Ctrl;