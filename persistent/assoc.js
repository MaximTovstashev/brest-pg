const _ = require('lodash');

module.exports = function(persistent, rows, table) {
    const pdata = {};
    if (!_.isString(persistent.collect_by)) {
        console.log(`Incorrect persistent description for ${table.name}: ${key} (collect_by field is missing or not a string):`);
        return persistent_next_step({error: `Incorrect persistent description for ${table.name}: ${key} (collect_by field is missing or not a string):`, persistent: persistent});
    }
    _.each(rows, function(row){
        if (_.isUndefined(row[persistent.collect_by])) {
            console.log(`WARNING: ${table.name}: ${key} has no entry for collect_by: ${persistent.collect_by}`);
        } else {
            pdata[row[persistent.collect_by]] = row;
        }
    });
    return pdata;
};