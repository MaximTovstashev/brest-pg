const BasicInjector = require('./basic');

class ReturningInjector extends BasicInjector {

    constructor(table) {
        super(table);
        this.replacement = this.table.primary.length ? ` RETURNING ${this.table.aliasClause}${this.table.primary.join(`, ${this.table.aliasClause}`)}` : '';
    }

    /**
     * Proceed with mandatory injection, defined by the query.
     * @param {String} query
     * @return {String}
     */
    force(query) {
        return query.replace(`{%returning%}`, this.replacement);
    }
}

module.exports = ReturningInjector;