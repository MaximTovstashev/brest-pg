const   _ = require('lodash'),
        format = require('pg-format');

const BasicInjector = require('./basic');

class UpdateInjector extends BasicInjector {

    /**
     * Format injection (done on normalizing injections object)
     * @param {String} injection
     * @param {Object} injectedObject
     * @return {*}
     */
    format(injection, injectedObject) {
        const values = [];
        _.each(injectedObject, function(value, column) {
            values.push(format('%I = %L', column, value));
        });
        return values.join(', ');
    }

}

module.exports = UpdateInjector;