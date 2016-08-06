const _ = require('lodash');

const BasicInjector = require('./basic');

const GLUE_AND = ' AND ';
const GLUE_OR = ' OR ';

class WhereInjector extends BasicInjector {

    /**
     * Format injection (done on normalizing injections object)
     * @param {String} injection
     * @param {*} value
     * @param {String} key
     * @return {String}
     */
    format(injection, value, key) {
        if (_.isArray(value) && _.isEmpty(value)) {
            return this.table.trueIfEmpty.has(key) ? ' true ' : ' false ';
        }
        return super.format(injection, value, key);
    }

    /**
     * Process all injections for the given tag
     * @param {String} query
     * @param {Object} normalizedInjections
     * @param filters
     * @return {string|XML|*|void}
     */
    inject(query, normalizedInjections, filters) {
        let injection;
        if (_.isArray(normalizedInjections)) {
            const orStrings = [];
            _.each(normalizedInjections, function(normalizedInjectionsBlock) {
                orStrings.push(_.values(normalizedInjectionsBlock).join(GLUE_AND));
            });
            injection = GLUE_AND + orStrings.join(GLUE_OR);
        } else {
            injection = GLUE_AND + _.values(normalizedInjections).join(GLUE_AND);
        }
        return query.replace('{{where}}', injection);
    }
}

module.exports = WhereInjector;