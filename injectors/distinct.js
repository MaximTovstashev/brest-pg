const BasicInjector = require('./basic');

class ReturningInjector extends BasicInjector {

    /**
     * Proceed with mandatory injection, defined by the query.
     * @param {String} query
     * @param {Object|Array} filters
     * @return {String}
     */
    force(query, filters) {
        return query.replace(`{%distinct%}`, ReturningInjector.filterValue(filters, '$distinct') ? ' DISTINCT ' : '');
    }
}

module.exports = ReturningInjector;