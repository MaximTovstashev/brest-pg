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

## 3 Changelist

### 0.0.1
- First working version

### 0.0.2
- BrestPG.tbl(table_name) now returns Table instances for given tables
- Fixed issue with injecting filters
- Fixed issue with row request  building incorrect query when receiving
 an object as parameter
