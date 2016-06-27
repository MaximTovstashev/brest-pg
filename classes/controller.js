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
     * @param {Number|Object} ids
     * @param {Object} [filters] Filters object
     * @param {Function} callback callback function
     */
    row(ids, filters, callback) {
        this.table.row(ids, filters, callback);
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
     * @param {Object} [options]
     * @param {Function} callback
     */
    insert(data, options, callback) {
        this.table.insert(data, options, callback);
    }

    /**
     * Default update request
     * @param {Object} data
     * @param {Object} [options]
     * @param {Function} callback
     */
    update(data, options, callback) {
        this.table.update(data, options, callback);
    }

    /**
     * Default delete request
     * @param {Number|Object} ids
     * @param callback
     */
    del(ids, callback) {
        this.table.del(ids, callback);
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
