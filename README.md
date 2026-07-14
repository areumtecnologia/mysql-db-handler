# @areumtecnologia/mysql-db-handler

A powerful, robust, and production-ready MySQL wrapper for Node.js. It features connection pooling, query caching (optional), jQuery DataTables server-side processing integration, safe error handling, and a flexible abstraction layer for CRUD operations.

## Table of Contents

* [Features](#features)
* [Installation](#installation)
* [Core Classes](#core-classes)
  * [DataBase (Standard Connection)](#1-database-standard-connection)
  * [DataBase (With Query & Schema Caching)](#2-database-with-query--schema-caching)
  * [DataBaseHandler (CRUD Abstraction)](#3-databasehandler-crud-abstraction)
* [Basic Usage](#basic-usage)
  * [1. Initializing Connection](#1-initializing-connection)
  * [2. Executing Raw SQL](#2-executing-raw-sql)
  * [3. Using the DataBaseHandler](#3-using-the-databasehandler)
* [Advanced Querying (`select` method)](#advanced-querying-select-method)
  * [Basic Selection](#basic-selection)
  * [Working with the `IN` and `NOT IN` Operators](#working-with-the-in-and-not-in-operators)
    * [Automatic `IN` Detection](#automatic-in-detection)
    * [Explicit `IN` / `NOT IN` Operator](#explicit-in--not-in-operator)
    * [Empty Array Safety (`IN ()` Protection)](#empty-array-safety-in-protection)
  * [Combining Multiple Conditions (AND / OR)](#combining-multiple-conditions-and--or)
* [CRUD Operations](#crud-operations)
  * [Inserting Records (`insert`)](#inserting-records-insert)
  * [Updating Records (`update`)](#updating-records-update)
  * [Deleting Records (`delete`)](#deleting-records-delete)
* [jQuery DataTables Server-Side Support](#jquery-datatables-server-side-support)
* [Database Singleton Pattern](#database-singleton-pattern)
* [Error Handling Strategy](#error-handling-strategy)
* [Contributing](#contributing)
* [License](#license)

---

## Features

* **Connection Pooling:** Efficiently manages and recycles database connections using `mysql2/promise`.
* **Flexible Query Builder:** Run complex operations without writing manual SQL strings.
* **Automatic `IN` Handling:** Smart processing of arrays for SQL `IN` and `NOT IN` operations (including prevention of empty array query crashes).
* **Optional Caching Wrapper:** Native support for query and schema caching using `node-cache` to boost performance.
* **Server-Side DataTables Integration:** Effortless integration with jQuery DataTables server-side requests, handling filters, sorting, search (global and column-based), regex, and count totals automatically.
* **Robust Error Handling:** Intercepts and wraps database errors in predictable objects to prevent application crashes.

---

## Installation

```bash
npm install @areumtecnologia/mysql-db-handler
```

If you wish to use the caching features, ensure `node-cache` is installed:
```bash
npm install node-cache
```

---

## Core Classes

The package exports the following primary components:

### 1. `DataBase` (Standard Connection)
Located in `lib/database.js`. Manages standard pooled connections, schema discovery, and query execution.

### 2. `DataBase` (With Query & Schema Caching)
Located in `lib/database-cache.js`. Overrides the standard `DataBase` implementation to provide in-memory query and table schema caching. It is ideal for read-heavy environments.

### 3. `DataBaseHandler` (CRUD Abstraction)
Located in `lib/databasehandler.js`. Bind this class to a specific table to perform database actions through utility methods (`select`, `selectBy`, `insert`, `update`, `delete`, `selectToDatatable`).

---

## Basic Usage

### 1. Initializing Connection

```javascript
const { DataBase } = require('@areumtecnologia/mysql-db-handler');

// Configuration matches mysql2 connection configuration
const db = new DataBase({
    host: 'localhost',
    user: 'root',
    password: 'password',
    database: 'my_app_db',
    port: 3306,
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0
});
```

### 2. Executing Raw SQL

Raw queries are executed through connection pooling. The library handles obtaining and releasing the connection automatically.

```javascript
try {
    const rows = await db.query('SELECT * FROM users WHERE active = ? AND role = ?', [1, 'editor']);
    console.log('Active editors:', rows);
} catch (error) {
    console.error('Database query failed:', error);
}
```

### 3. Using the DataBaseHandler

Wrap a table with a handler to abstract SQL construction.

```javascript
const { DataBase, DataBaseHandler } = require('@areumtecnologia/mysql-db-handler');

const db = new DataBase({ /* config */ });
const usersHandler = new DataBaseHandler(db, 'users');
```

---

## Advanced Querying (`select` method)

The `select(params, clauses)` method builds complex SQL `WHERE` clauses from arrays of condition objects.

### Basic Selection

You can pass condition objects where the key is the column name and the value is the target value.

```javascript
// Simple equals comparison (=)
const users = await usersHandler.select([
    { role: 'admin' }
]);
// Executes: SELECT * FROM users WHERE `role` = ?
```

### Working with the `IN` and `NOT IN` Operators

The library provides special support for SQL `IN` operations by mapping JavaScript arrays to queries.

#### Automatic `IN` Detection
If a condition's value is an array, and no operator is explicitly set, the query builder automatically treats it as an `IN` statement:

```javascript
const activeUsers = await usersHandler.select([
    { status: ['active', 'pending'] }
]);
// Executes: SELECT * FROM users WHERE `status` IN (?, ?)
// Bindings: ['active', 'pending']
```

#### Explicit `IN` / `NOT IN` Operator
You can explicitly define the `operator` as `'IN'` or `'NOT IN'`:

```javascript
// Using NOT IN explicitly
const nonAdminUsers = await usersHandler.select([
    { role: ['admin', 'superadmin'], operator: 'NOT IN' }
]);
// Executes: SELECT * FROM users WHERE `role` NOT IN (?, ?)
// Bindings: ['admin', 'superadmin']
```

#### Empty Array Safety (`IN ()` Protection)
In standard SQL, executing a query with an empty array in the `IN` clause (e.g., `WHERE status IN ()`) yields a syntax error and crashes the execution. The library automatically mitigates this:

* **Empty `IN`**: Evaluates to `1 = 0` (always false). No records match this sub-clause, ensuring safe execution.
* **Empty `NOT IN`**: Evaluates to `1 = 1` (always true). All records match this sub-clause, returning all values since nothing is excluded.

```javascript
// Safe empty array handling
const results = await usersHandler.select([
    { id: [], operator: 'IN' }
]);
// Executes: SELECT * FROM users WHERE 1 = 0

const allResults = await usersHandler.select([
    { id: [], operator: 'NOT IN' }
]);
// Executes: SELECT * FROM users WHERE 1 = 1
```

### Combining Multiple Conditions (AND / OR)

Interleave condition objects with string elements representing logical operators:

```javascript
const filteredProducts = await productsHandler.select(
    [
        { category: 'electronics' },
        'AND',
        { price: 500, operator: '>' },
        'AND',
        { brand: ['Sony', 'LG'] } // Automatically mapped to IN
    ],
    {
        'ORDERBY': 'price',
        'DESC': true,
        'LIMIT': 20
    }
);
// Executes: 
// SELECT * FROM products WHERE `category` = ? AND `price` > ? AND `brand` IN (?, ?) ORDER BY price DESC LIMIT 20
```

---

## CRUD Operations

### Inserting Records (`insert`)

Adds a new row to the associated table using key-value properties.

```javascript
const result = await usersHandler.insert({
    name: 'John Doe',
    email: 'john.doe@example.com',
    role: 'member',
    created_at: new Date()
});

console.log('Inserted ID:', result.insertId);
```

### Updating Records (`update`)

Performs selective updates by specifying both a `set` payload and a `where` filter.

```javascript
const result = await usersHandler.update({
    set: {
        status: 'suspended',
        notes: 'Violated terms of service'
    },
    where: {
        id: 42,
        status: 'active'
    }
});

console.log('Affected rows:', result.affectedRows);
```

### Deleting Records (`delete`)

Deletes rows matching the conditions object (joined by implicit `AND` operators).

```javascript
const result = await usersHandler.delete({
    status: 'temporary',
    is_expired: 1
});

console.log('Deleted rows:', result.affectedRows);
```

---

## jQuery DataTables Server-Side Support

The `selectToDatatable` method processes the complex nested payloads sent by jQuery DataTables server-side scripts and returns the required format.

```javascript
// Express.js Route Example
app.post('/api/users/dt', async (req, res) => {
    // req.body contains the DataTables standard payload:
    // { draw: 1, start: 0, length: 10, search: { value: 'John', regex: false }, columns: [...] }
    
    // You can enforce strict conditions that the client cannot bypass (e.g., tenant containment)
    const strictConditions = [
        { tenant_id: req.user.tenantId },
        'AND',
        { status: 'deleted', operator: '!=' }
    ];

    const datatableResult = await usersHandler.selectToDatatable(req.body, strictConditions);
    
    // Returns: { draw: 1, recordsTotal: 100, recordsFiltered: 12, data: [...] }
    res.json(datatableResult);
});
```

---

## Database Singleton Pattern

To prevent initializing redundant pool connections across various modules in a Node.js project, it is highly recommended to configure a single shared instance (Singleton).

Create a `db.js` file:
```javascript
// db.js
const { DataBase } = require('@areumtecnologia/mysql-db-handler');

const dbInstance = new DataBase({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: parseInt(process.env.DB_POOL_LIMIT) || 10
});

module.exports = dbInstance;
```

Import it in your business controllers/repositories:
```javascript
// usersRepository.js
const db = require('./db');
const { DataBaseHandler } = require('@areumtecnologia/mysql-db-handler');

const usersHandler = new DataBaseHandler(db, 'users');

module.exports = {
    getUserById: (id) => usersHandler.selectBy({ id })
};
```

---

## Error Handling Strategy

Database exceptions generated during execution are caught internally by the `DataBase` instance. This means that instead of raising unhandled exceptions that could crash your Node.js application, the library wraps the error.

Specifically, the following methods from **`DataBase`** and **`DataBaseHandler`** return an object with an `error` property when an execution error occurs:
*   `DataBase.query()`
*   `DataBaseHandler.select()` / `selectBy()`
*   `DataBaseHandler.insert()`
*   `DataBaseHandler.update()`
*   `DataBaseHandler.delete()`
*   `DataBaseHandler.selectToDatatable()`

### Example: Checking for errors in queries

```javascript
// Example with Select if column doesn't exist (triggers database error)
const users = await usersHandler.select([{ non_existent_column: 'admin' }]);
if (users.error) {
    console.error('Failed to select users:', users.error.message);
}

// Example with Insert
const insertResult = await usersHandler.insert({ name: 'John Doe' });
if (insertResult.error) {
    console.error('Failed to insert user:', insertResult.error.message);
}

// Example with Update
const updateResult = await usersHandler.update({
    set: { status: 'active' },
    where: { id: 999 }
});
if (updateResult.error) {
    console.error('Failed to update user:', updateResult.error.message);
}

// Example with Delete
const deleteResult = await usersHandler.delete({ id: 999 });
if (deleteResult.error) {
    console.error('Failed to delete user:', deleteResult.error.message);
}
```

> [!NOTE]
> If you execute a `select` using valid columns but search for values that do not exist in the table (e.g. `await usersHandler.select([{ role: 'non_existent_role' }])`), this is **not** considered a database error. The query will execute successfully and return an empty array `[]` (without any `error` property). An error is only returned for actual database execution failures (such as syntax errors, missing columns, database connection drops, etc.).

---

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

MIT
