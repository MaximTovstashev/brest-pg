const _db = require('../../index'),
    expect = require('chai').expect;

const TABLE_TEST_PERSON = 'test_person';

it('Should return object by {id:%id}', function(done){
    const TestPerson = _db.tbl(TABLE_TEST_PERSON);
    TestPerson.row({id: 1}, (err, person) => {
        expect(err).to.be.null;
        expect(person).to.be.an('object');
        expect(person).to.have.all.keys(['id', 'name', 'attitude', 'height', 'iq']);
        expect(person.id).to.be.equal(1);
        expect(person.name).to.be.equal('John Doe');
        expect(person.attitude).to.be.equal('bad');
        expect(person.height).to.be.equal(180);
        expect(person.iq).to.be.equal(90);
        done();
    })
});

it('Should return object by id as int', function(done){
    const TestPerson = _db.tbl(TABLE_TEST_PERSON);
    TestPerson.row(1, (err, person) => {
        expect(err).to.be.null;
        expect(person).to.be.an('object');
        expect(person).to.have.all.keys(['id', 'name', 'attitude', 'height', 'iq']);
        expect(person.id).to.be.equal(1);
        expect(person.name).to.be.equal('John Doe');
        expect(person.attitude).to.be.equal('bad');
        expect(person.height).to.be.equal(180);
        expect(person.iq).to.be.equal(90);
        done();
    })
});

it('Should return error for missing value', function(done){
    const TestPerson = _db.tbl(TABLE_TEST_PERSON);
    TestPerson.row(0, (err, person) => {
        expect(err).to.be.not.null;
        expect(err.code).to.be.equal(404);
        expect(err.error).to.contain('No test_person found with given filters');
        done();
    })
});

it('Should throw exception when no callback provided', function(done){
    const TestPerson = _db.tbl(TABLE_TEST_PERSON);
    expect(()=>{TestPerson.row()}).to.throw(Error);
    done();
});

it('Should return first record when no filters provided', function(done){
    const TestPerson = _db.tbl(TABLE_TEST_PERSON);
    TestPerson.row((err, person) => {
        expect(err).to.be.null;
        expect(person).to.be.an('object');
        expect(person.id).to.be.equal(1);
        done();
    })
});