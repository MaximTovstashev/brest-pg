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

    check() {
        return `Check ${this.name}`;
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
     * @param data
     * @param callback
     */
    insert(data, callback) {
        this.table.insert(data, callback);
    }

    /**
     * Default update request
     * @param data
     * @param callback
     */
    update(data, callback) {
        this.table.update(data, callback);
    }

    /**
     * Default delete request
     * @param {Number|Object} ids
     * @param callback
     */
    del(ids, callback) {
        this.table.del(ids, callback);
    }

}

module.exports = Controller;