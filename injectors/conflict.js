const BasicInjector = require('./basic');

class ConflictInjector extends BasicInjector {

    constructor(table) {
        super(table);
        this.resolve = {
            do_nothing: 'ON CONFLICT DO NOTHING',
            do_update: `ON CONFLICT (${this.table.primary.join(',')}) DO UPDATE SET (${this.table.non_primary.join(', ')}) = (EXCLUDED.${this.table.non_primary.join(', EXCLUDED.')})`
        }
    }

    /**
     * Proceed with mandatory injection, defined by the query.
     * @param query
     * @param filters
     * @param tag
     * @return {string|XML|*|void}
     */
    force(query, filters, tag) {
        let conflict = '';
        if (filters.conflict) {
            if (this.resolve[filters.conflict]) {
                conflict = ' ' + this.resolve[filters.conflict];
            } else {
                console.log(`WARNING: non-existing conflict resolve mode ${mode}`);
            }
        }

        return query.replace('{%conflict%}', conflict);
    }
}

module.exports = ConflictInjector;