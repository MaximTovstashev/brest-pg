const   async = require('async'),
        expect = require('chai').expect,
        fs = require('fs'),
        pg = require('pg');

const pool = new pg.Pool(require('./settings'));

const brest = require('./mock/brest');
const _db = require('../index');

// pool.connect()

function load(name, path) {
    describe(name, function () {
        require(path);
    });
}

describe('Brest-PG', function(){

    before(function(done){

        pool.connect(function(err, client, done_connecting) {
            if(err) {
                return console.error('error fetching client from pool', err);
            }
            async.waterfall([
                (next) => {
                    const sql = fs.readFileSync('./test/data/test-person.sql', 'utf8');
                    client.query(sql, next);
                },
                (result, next) => {
                    done_connecting();
                    _db.init(brest, next)
                }
            ],(err)=>{
                if(err) {
                    console.error('Init error', err);
                }
                done();
            });
        });

        pool.on('error', function (err) {
            console.error('Failed to initialize test environment', err.message, err.stack);
            done();
        })
    });

    it('Should initialize itself correctly', function (done) {
            expect(brest.db).to.be.not.null;
            expect(brest.db.tables).to.be.not.null;
            expect(brest.db.controllers).to.be.not.null;
            done();
    });

    load('Model', './tests/model-generic.js');
    load('Model:Row', './tests/model-row.js');

});