# brest-pg
PostgreSQL library for Brest

## 1. Usage

### 1.1 Setup

Setup via npm

`npm install brest-pg`

In Brest project settings.js file, add postgres key:

```
    postgres: {
        host: 'localhost',
        port: 5432,
        db: 'foobar',
        user: 'foobar_admin',
        password: 'SevenAsterisks123'
    },
```

### 1.2 Initialize as Brest module

```javascript
	const BrestPG = require('brest-pg');
	//...
	brest.use([BrestPG]);
```

### 1.3 Link tables

BrestPG automatically keeps track of database tables, creating
table objects and controllers for each table in the database.

## 2 Request Cheatsheet

- %% outputs a literal % character.
- %I outputs an escaped SQL identifier. (e.g. table name)
- %L outputs an escaped SQL literal. (value)
- %s outputs a simple string.

## 3 Persistent constants

- PERSISTENT_MODE_SIMPLE: The rows are stored as an array of objects. Keys are the array indices.
- PERSISTENT_MODE_ASSOC: The rows are stored as an object {[collect_by]: {row}}. Duplicate values are overwritten
- PERSISTENT_MODE_ARRAY_BUNDLE: The rows are bundled into arrays.
- PERSISTENT_MODE_ARRAY_KEY: The values of [collect_from] rows are stored in array bundles

## 4 Changelist

### 0.0.7

- Persistent functionality is seriously reworked
- "Not found" reply for row request now contain ids and filters
- "Not found" reply is less DB-specific, as it can be thrown directly back to API user
- Filters objects for Controller::exists and Table::exists are requred to contain data
- Custom filters can be passed into row() first param alongside column names. If custom filter is associated
with column name it still has to be passed as a second parameter.
- Added "limit" and "order" autofilters
- Fixed issue with "null_" and "not_null_" auto filters rendering incorrect query
- Fixed issue with update, broken by preprocessing call
- Fixed issue with JOIN in SELECT causing incorrect ids

### 0.0.6

- Default "exists" Controller method callback now returns homogeneous reply: {exists: true|false, ...(filter fields)}

### 0.0.5
- Fixed issue with count & exists methods not working
- Added default crud options to Table
- Added Transform middleware to Table

### 0.0.2
- BrestPG.tbl(table_name) now returns Table instances for given tables
- Fixed issue with injecting filters
- Fixed issue with row request  building incorrect query when receiving
 an object as parameter

### 0.0.1
- First working version