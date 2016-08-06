const   _ = require('lodash'),
        format = require('pg-format');

class BasicInjector {

    constructor(table) {
        this.table = table;
        this.glue = ' ';
    }

    /**
     * Format injection (done on normalizing injections object)
     * @param {String} injection
     * @param {*} value
     * @param {String} key
     * @return {String}
     */
    format(injection, value, key) {
        return format(injection, value);
    }

    /**
     * Process all injections for the given tag
     * @param query
     * @param normalizedInjections
     * @param filters
     * @param tag
     * @return {string|XML|*|void}
     */
    inject(query, normalizedInjections, filters, tag) {
        let injectionObject = normalizedInjections;
        if (_.isArray(normalizedInjections)) {
            injectionObject = {};
            _.each(normalizedInjections, function(injectionBlock){
                injectionObject = _.defaults(injectionObject, injectionBlock);
            })
        }
        return query.replace(`{{${tag}}}`, this.glue + _.values(injectionObject).join(this.glue));
    }

    /**
     * Proceed with mandatory injection, defined by the query.
     * @param query
     * @param filters
     * @param tag
     * @return {string|XML|*|void}
     */
    force(query, filters, tag) {
        return query.replace(`{%${tag}%}`, '');
    }

    /**
     * Return first occured filter value
     * @param {Object|Array} filters
     * @param {String} key
     * @return {*}
     */
    static filterValue(filters, key) {
        if (_.isObject(filters) && !_.isArray(filters)) return filters[key];
        if (_.isArray(filters)) return _.find(filters, key);
    }
}

module.exports = BasicInjector;