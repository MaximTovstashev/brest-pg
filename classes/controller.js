const _ = require('lodash');

const httpStatus = require('../lib/http_status_codes');

class Controller {

    get name() {
        return this.table.name;
    }

    /**
     *
     * @param {Table} table
     */
    constructor(table) {
        this.table = table;
        this.ctrl = require('../index').controllers;
    }

    /**
     * Default row request
     * @param {Number|String|Object} [filters] Filters object
     * @param {Function} callback callback function
     */
    row(filters, callback) {
        this.table.row(filters, callback);
    }

    /**
     * Default list request
     * @param filters
     * @param callback
     */
    list(filters, callback) {
        this.table.list(filters, callback);
    }

    /**
     * Default insert request
     * @param {Object} data
     * @param {Object} [filters]
     * @param {Function} callback
     */
    insert(data, filters, callback) {
        this.table.insert(data, filters, callback);
    }

    /**
     * Default update request
     * @param {Object} data
     * @param {Object} [filters]
     * @param {Function} callback
     */
    update(data, filters, callback) {
        this.table.update(data, filters, callback);
    }

    /**
     * Default delete request
     * @param {Number|Object} filters
     * @param callback
     */
    del(filters, callback) {
        this.table.del(filters, callback);
    }


    /**
     * Return the number of records matching the request. Count all records by default
     * @param filters
     * @param callback
     */
    count(filters, callback) {
        this.table.count(filters, callback);
    };

    /**
     * Returns true if query
     *
     * @param filters
     * @param callback
     */
    exists(filters, callback) {
        if (_.isEmpty(filters)) return callback({error: `Empty request for ${this.name} entry existance check`, code: httpStatus.UNPROCESSABLE_ENTITY});
        this.table.exists(filters, function(err, exists){
            if (err) return callback(err);
            callback(null, _.defaults(filters, {exists: exists}));
        });
    };

    /**
     * Wrapper for Table::defaultFilters
     * @param {Object} filters
     * @param {String[]} exclude
     * @returns {Object}
     */
    defaultFilters(filters, exclude) {
        return this.table.defaultFilters(filters, exclude);
    }

}

module.exports = Controller;
