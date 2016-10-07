const _db = require('../../index'),
      expect = require('chai').expect;

const TABLE_TEST_PERSON = 'test_person';

it('Should build model by table name', function(done){
    const TestPerson = _db.tbl(TABLE_TEST_PERSON);
    expect(TestPerson).not.to.be.undefined;
    expect(TestPerson.name).not.to.be.undefined;
    expect(TestPerson.name).to.be.equal(TABLE_TEST_PERSON);
    done();
});

it('Should recognize columns in the table', function (done) {
    const TestPerson = _db.tbl(TABLE_TEST_PERSON);
    expect(TestPerson.columns).to.have.all.keys(['id', 'name', 'attitude', 'height', 'iq']);
    done();
});

it('Should recognize numeric fields in the table', function (done) {
    const TestPerson = _db.tbl(TABLE_TEST_PERSON);
    expect(TestPerson.numeric.has('id')).to.be.true;
    expect(TestPerson.numeric.has('height')).to.be.true;
    expect(TestPerson.numeric.has('iq')).to.be.true;
    expect(TestPerson.numeric.size).to.be.equal(3);
    done();
});

it('Should recognize nullable fields in the table', function (done) {
    const TestPerson = _db.tbl(TABLE_TEST_PERSON);
    expect(TestPerson.nullable.has('attitude')).to.be.true;
    expect(TestPerson.nullable.has('iq')).to.be.true;
    expect(TestPerson.nullable.size).to.be.equal(2);
    done();
});

it('Should recognize primary fields correctly', function (done) {
    const TestPerson = _db.tbl(TABLE_TEST_PERSON);
    expect(TestPerson.primary.length).to.be.equal(1);
    expect(TestPerson.primary).to.include('id');
    done();
});

it('Should recognize non-primary fields correctly', function (done) {
    const TestPerson = _db.tbl(TABLE_TEST_PERSON);
    expect(TestPerson.non_primary.length).to.be.equal(4);
    expect(TestPerson.non_primary).not.to.include('id');
    expect(TestPerson.non_primary).to.include.members(['name', 'attitude', 'height', 'iq']);
    done();
});