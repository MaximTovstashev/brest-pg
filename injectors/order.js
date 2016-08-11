const _ = require('lodash'),
    format = require('pg-format');

const ASC = 'ASC';
const DESC = 'DESC';
const POSSIBLE_DIRECTIONS = new Set([ASC, DESC]);


const BasicInjector = require('./basic');

class OrderInjector extends BasicInjector {


    /**
     * Format injection (done on normalizing injections object)
     * @param {String} injection
     * @param {Array|String} order
     * @return {*}
     */
    format(injection, order) {
        order = order.split(',');
        if (_.isArray(order)) {
            const preparedSort = [];
            let customSort = false;
            _.each(order, (field) => {
                const splitted = field.split(':');
                const sort_column = splitted[0].toLowerCase();
                if (POSSIBLE_DIRECTIONS.has(splitted[0].toUpperCase())) {
                    customSort = format(injection, splitted);
                    return false;
                } else {
                    if (_.isUndefined(this.table.columns[sort_column])) {
                        console.log(`Invalid sort field ${sort_column}`);
                        return '';
                    }
                    const sort_order = splitted[1] ? splitted[1].toUpperCase() : ASC;
                    if (POSSIBLE_DIRECTIONS.has(sort_order)) {
                        preparedSort.push(`${this.table.aliasClause}${sort_column} ${sort_order}`);
                    } else {
                        console.log(`Invalid direction ${sort_order}`);
                    }
                }
            });
            if (customSort) return customSort;
            if (preparedSort.length) {
                return ` ORDER BY ${preparedSort.join(', ')}`;
            }
        } else throw "Failed to parse order filter"
    }
}

module.exports = OrderInjector;