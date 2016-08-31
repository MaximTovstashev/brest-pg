# brest-pg
PostgreSQL library for Brest.

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

When you will require additional functionality, you can extend basic _Table_ and _Controller_ classes.

### 1.4 Default methods
#### 1.4.1 Table.row(filters, callback)

Request a single row from the database. If a single value is passed as _filters_ parameter, it is treated as
filter by first primary field, so if the primary key covers more than one column you might want to pass them as an object.

Request is automatically limited to one row, which is passed to callback as an object. If no records in the table match the
filtering, the callback is called with an error. Please, note that same behaviour will occur on empty tables.

If you suppose that having none, or more than one result is a normal situation for the request, you should use _list_ method.

You can also use **$allowEmpty:true** filter directive to suppress error on empty result.

#### 1.4.2 Table.list(filters, callback)

Same as Table.row, but the array of records is returned. If no records match the filtering,
an empty array is passed to callback.

As a custom filter, you can use **$recursive** to ensure that default query will be built with recursion in mind.

Use **$distinct** filter directive to perform "SELECT DISTINCT" query.

#### 1.4.3 Table.insert(data, filters, callback)

Insert new record into the table. Here, filtering is pretty much limited and used mostly to pass options.

**$preprocess** filter is used to pass custom preprocessing functions to the request.

```javascript
{
    $preprocess: [
        {
		fields: ['foo', 'bar'],
		fn: function(value) {return value*2}
    	},
	{
		fields: ['foz', 'baz'],
		fn: function(value) {return value+'Oops'}
	},
    ]
}
```

Callback returns the primary keys for the newly inserted row, unless **returning** is overridden in class definition.

#### 1.4.4 Table.update(data, filters, callback)

Update table with **data**.

By default, the columns with primary keys are used to defined updated records. You can override that with
**$update_by** filter directive. **$update_by** is an array of column names.

 ```javascript
 {
    $update_by: ['username', 'gender']
 }
 ```

Any other appliable filter from which "WHERE" query can be built, can be used to define updated records as well.

**$preprocess** works on data in the same manner it does in Table.insert. Please keep in mind, that data is first
_preprocessed_ and then passed to **$update_by**, which means, that under certain conditions, the fields you use to
define updated records may also be preprocessed.

#### 1.4.5 Table.delete(filters, callback)

Delete table records.

*filters* parameter is treated the same way as in Table.row with the only difference that empty filter object
is forbidden by default (as it will delete all table records in one go).

Use **$forceEmptyDelete** filter directive or custom query, if it is what you really want.

Callback returns primary keys of deleted entries, unless **returning** is overridden in class definition.

#### 1.4.6 Table.count(filters, callback)

Return the number of filtered records. Any filters apply except for **limit**

#### 1.4.7 Table.exists(filters, callback)

Returns **true** if at least one filtered record exists. It is a shortcut for Table.count, cast to boolean.

### 2 Filters

### 2.1 Introduction

Brest-pg is developed to work with Brest request filters, and provides a large amount of automatically
generated filters, as well as tools for creating user-defined filtering.

```javascript
	function cherchez_la_femme(callback) {
		User.list({gender: 'f'}, callback);
	}
```

While the primary goal of filters is to narrow down the request, it can also expand it, by using "join" override.

Please note, that while expanding basic requests with filters should suffice most of the needs, it is not an
ultimate tool and it is highly recommended to implement custom SQL queries, when request is complex or specific.

You can expand custom request by the use of filter templating as well.

Filters are passed as key/value object into the respective table methods. Filters can be combined, but no additional
sanity check is made, so some filter combination may lead to unusual, unpredictable, faulty or malicious results.

```javascript
	function find_knights(callback) {
		Character.list({has_shining_armour: true, has_white_horse: true}, callback);
	}
```

### 2.2 Automatically generated filters

Each table is initialized with autofilters for each column:

- **"%column%"**: select rows with %column% equal to filter value

```javascript
	function cherchez_la_femme(callback) {
		User.list({gender: 'f'}, callback);
	}
```

- **"%column%s"**: select rows with %column% values belong to provided array.
If provided array is empty, this clause is treated as "false"

```javascript
	//Column is "manufacturer"
	function find_german_cars(callback) {
		Car.list({manufacturers: ['audi', 'bmw', 'mersedes', 'opel', 'porsche', 'volkswagen']}, callback);
	}
```

- **"not_%column%"**: select rows with column not equal to filter value
```javascript
	//Column is "skirt_color"
	function find_survivors(callback) {
		Crew.list({not_skirt_color: 'red'}, callback);
	}
```
- **"not_%column%s"**: select rows with %column% values not beloning to provided array.
If provided array is empty, this clause is treated as "true"
```javascript
	//Column is "color"
	function not_in_rainbow(callback){
		Paint.list({not_colors: ['red','orange','yellow','green','blue','indigo','violet']}, callback);
	}
```

- **"null_%column%s"**: select rows with not NULL %column% value
```javascript
	//Column is "hair_color"
	function find_hairless(callback) {
		User.list({null_hair_color: true}, callback);
	}
```

Please, note, that null-comparison filters are generated only for nullable fields

-**"%column%_gt"**: select rows with column value greater than filter value
```javascript
	//Column is "height"
	function higher_than_eiffel_tower(callback) {
		Building.list({height_gt: 324}, callback);
	}
```

- **"%column%_lt"**, **"%column%_gte"**, **"%column%_lte"**: same as previous, for "less than", "greater or equal" and "less or equat" comparisons.

Please, note that comparison filters are generated only for numeric fields

 - **limit**: limit search result. Limit filter accepts an array [limit, offset = 0],
 with optional second element. It behaves exactly as Postgres LIMIT/OFFSET

 - **order**: sort the result by provided column name

 ### 2.3 Custom filters

  Custom filters can be defined in custom classes constructors.
```javascript
	class User extends Table {
		constructor(db) {
			super(db, 'user', 'u');
			//...
			this.filters = {
				organisation_id: {
					description: `Select users from specific organisation`,
					join: ` LEFT JOIN user_organisation AS ut ON ut.user_id = u.id`,
					where: ` AND ut.organisation_id = %L`
				}
			};
    	}
    }
```

Each filter is described in filters object by it's name (organisation_id in example above) and it's fields.

"description" field is used for automaticall passing filters into API. The rest of the fields are request injections.
Technically, any string contained in double curly parentheses is considered an injection template,
but only the following are actually used in defailt queries:

- {{select}}
- {{join}}
- {{where}}
- {{group}}
- {{having}}
- {{order}}
- {{limit}}

For your custom queries you can use any injection templates you like.
If no injection is found in filters, they are ignored

### Filter folding

While default filter behaviour is desinged to communicate with Rest API generated by Brest, it might be sometimes
 invonvenient to use it for compex filtering inside of the project.

 There's an alternative way to combine filters,
 called "folding": when you apply several filters to one column, you can pass them in a single object, with column name as a key,
 instead of multiple entries.

 ```javascript
 	function height_between(from, to, callback) {
 		User.list({height: {
 			gte: from,
 			lte: to
 		}}, callback);
 	}
 ```

which is equal to

```javascript
 	function height_between(from, to, callback) {
 		User.list({height_gte: from,
 				   height_lte: to}, callback);
 	}
 ```

You can use the following folding keys:

            'eq': '%s',
            'neq': 'not_%s',
            'in': '%ss',
            'nin': '%ss',
            'null': 'null_%s',
            'nnull': 'not_null_%s',
            'gt': '%s_gt',
            'gte': '%s_gte',
            'lt': '%s_lt',
            'lte': '%s_lte'

## 3 Misc
### 3.1 Request Cheatsheet

- %% outputs a literal % character.
- %I outputs an escaped SQL identifier. (e.g. table name)
- %L outputs an escaped SQL literal. (value)
- %s outputs a simple string.

### 3.2 Persistent constants

- PERSISTENT_MODE_SIMPLE: The rows are stored as an array of objects. Keys are the array indices.
- PERSISTENT_MODE_ASSOC: The rows are stored as an object {[collect_by]: {row}}. Duplicate values are overwritten
- PERSISTENT_MODE_ARRAY_BUNDLE: The rows are bundled into arrays.
- PERSISTENT_MODE_ARRAY_KEY: The values of [collect_from] rows are stored in array bundles

### 3.3 Upsert options

Options passed to insert:

- {conflict: 'do_nothing'} Do nothing on insert conflict
- {conflict: 'do_update'} Update existing record with new data

### 3.4 Limit restrictions

By default you can have maximun 100 records in the list request. It can't be overridden by direct filter request, but you can change

```
	this.topLimit = 500;
```

in table constructor

### 3.5 Order format

'order' filter has the following format: ?order={field1}:[ASC|DESC],{field2}:[ASC|DESC],(...),{fieldN}:[ASC|DESC]

```
	v1/user?order=id:asc,first_name:desc
```

Ascending direction can be skipped

```
	v1/user?order=id,first_name:desc
```
Char case is arbitrary

```
	v1/user?order=Id:Asc,First_Name:DESC
```


## 4 Changelist

### 0.1.7

- row "filters" is cast to (IS NULL %id%) instead of (%id% = NULL) when filters is null.

### 0.1.6

- Added 'data_type' to table info request

### 0.1.5

- Fixed crashing "update" when update data is empty. Now "success" with "warning" field is returned.

### 0.1.4

- filters are no longer modified within Table methods
- alias is added to "order" clause

### 0.1.3

- Fixed: incorrect 'DISTINCT' position

### 0.1.2

- Custom "order" filter can be built to accept "direction-only" params

### 0.1.1

- Fixed Controller class to comply with changes in Table

### 0.1.0

- Table.row now accepts only two parameters: filters and callback. "filters" can be a single Number/String value
- Table.row and Table.list now use same *Table.queries.select* query template
- Table.delete doesn't accept empty filters unless forced
- Table.delete doesn't accept 'limit' filter as it is not supported by PostgreSQL
- "update_by" filter is now spelled as $update_by
- $recursive filter directive added for select queries
- $distinct filter directive added for select queries
- Emply arrays no longer break requests
- Filters can be bundled into arrays to create OR queries
- Removed "temp fix" for custom string in sorting order: use custom filters instead!
- Lot's of internal refactoring

### 0.0.14-1

- Upgraded 'pg' to 6.0.3

### 0.0.14

- Temp fix: passing custom string as a sorting order
- 'limit' filter can be a number

### 0.0.13

- Update options "update_by" added.

### 0.0.12

- Upsert options added
- Removed broken limit cast to Array
- Added limit now can't be set by filter higher than Table::topLimit
- Fixed issue with 'order' filter vulnerabilities
- Introduced new format for 'order'

### 0.0.11-1

- Temporary "limit" filter fix

### 0.0.11

- Fixed "order" filter to be parsed correctly
- Fixed "order" filter to respect string case

### 0.0.10

- Recursive filters and filtered queries. Somewhat unstable, pretty much unpredictable

### 0.0.9

- Numeric columns now have comparison autofilters %column%_gt, %column%_gte, %column%_lt, %column%_lte
- Implemented filter folding
- "null_%column%", "not_null_%column%" autofilters are now generated only for nullable columns

### 0.0.8

- Fixed "limit" injection to comply with PostgreSQL syntax
- Default filters are now always generated as objects
- "limit" and "order" filters are now injected into Brest as objects

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

### 0.0.6-1

- Fixed bug with empty Transform middleware

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
