const _ = require('lodash'),
      format = require('pg-format');

const BasicInjector = require('./basic');

class LimitInjector extends BasicInjector {


    /**
     * Format injection (done on normalizing injections object)
     * @param {String} injection
     * @param {Array|Number} limit
     * @return {*}
     */
    format(injection, limit) {
        if (_.isArray(limit)) {
            for (var i = 0; i < limit.length; i++) {
                limit[i] = parseInt(limit[i]);
            }
            limit[0] = Math.min(this.table.topLimit, limit[0]);
            if (limit.length == 1) return format(` LIMIT ${limit[0]}`);
            else if (limit.length == 2) return ` LIMIT ${limit[0]} OFFSET ${limit[1]}`;
            else throw "Incorrect number of limit params (1 or 2 expected)"
        } else if (limit === parseInt(limit)) {//limit is int
            return ` LIMIT ${parseInt(limit)}`;
        } else throw "Failed to parse limit filter";
    }
}

module.exports = LimitInjector;