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
* [jQuery DataTables Server-Side Support (`selectToDatatable`)](#jquery-datatables-server-side-support-selecttodatatable)
  * [Key Features & Performance](#key-features--performance-optimizations)
  * [Method Signature](#method-signature)
  * [Basic Express.js Example](#basic-expressjs-example)
  * [Enforcing Backend Security (`strictCondition`)](#enforcing-backend-security-strictcondition)
  * [Using JOINs and Custom Expressions](#using-joins-and-custom-expressions)
  * [Frontend jQuery DataTables Setup](#frontend-jquery-datatables-setup)
  * [Response Structure & Error Handling](#response-structure--error-handling)
* [Transaction Support (ACID & Transparent)](#transaction-support-acid--transparent)
  * [1. Explicit Block (`db.transaction`)](#1-explicit-block-dbtransaction)
  * [2. Singleton Compatibility with `AsyncLocalStorage`](#2-singleton-compatibility-with-asynclocalstorage)
  * [3. Post-Commit Hook (`db.onCommit`)](#3-post-commit-hook-dboncommit)
  * [4. Route Wrapper (`db.transactional`)](#4-route-wrapper-dbtransactional)
  * [5. Express Lazy Middleware (`db.autoTransaction`)](#5-express-lazy-middleware-dbautotransaction)
  * [6. Nested Transactions & Savepoints](#6-nested-transactions--savepoints)
* [Database Singleton Pattern](#database-singleton-pattern)
* [Error Handling Strategy](#error-handling-strategy)
* [Contributing](#contributing)
* [License](#license)

---

## Features

* **Connection Pooling:** Efficiently manages and recycles database connections using `mysql2/promise`.
* **ACID Transactions:** Comprehensive transaction management with automatic `BEGIN`, `COMMIT`, `ROLLBACK`, and safe connection release.
* **Transparent Singleton Support:** Powered by native Node.js `AsyncLocalStorage`. Shared table singletons automatically adopt the current transaction without passing `tx` around.
* **Post-Commit Hooks (`onCommit`):** Execute external tasks (banking APIs, emails, webhooks) strictly after database transactions successfully commit.
* **Express Lazy Middleware:** Zero-code change transactions via `db.autoTransaction()`. Reads remain non-blocking on the pool, while write operations seamlessly open and commit transactions on demand.
* **Savepoints (Nested Transactions):** Safely run sub-transactions with partial rollback support without aborting outer transactions.
* **Flexible Query Builder:** Run complex operations without writing manual SQL strings.
* **Automatic `IN` Handling:** Smart processing of arrays for SQL `IN` and `NOT IN` operations (including prevention of empty array query crashes).
* **Optional Caching Wrapper:** Native support for query and schema caching using `node-cache` (automatically bypassed during active transactions).
* **Server-Side DataTables Integration:** Effortless integration with jQuery DataTables server-side requests, handling filters, sorting, search (global and column-based), regex, and count totals automatically.
* **Robust Error Handling:** Intercepts and wraps database errors in predictable objects outside transactions, while throwing inside transactions to ensure immediate rollback.

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

Performs selective updates by specifying both a `set` payload and a `where` filter. The `where` filter supports both standard flat objects (where conditions are implicitly joined by `AND` using `=` or `REGEXP`) and complex array configurations (with operators, `AND`, and `OR`), sharing the same advanced querying capabilities as the `select` method.

#### 1. Simple Object Syntax (Implicit AND, = operator)

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
// Executes: UPDATE users SET `status` = ?, `notes` = ? WHERE `id` = ? AND `status` = ?
```

#### 2. Advanced Array Syntax (with operators, AND/OR, and IN)

You can pass an array of condition objects interleaved with `AND` or `OR` string elements to construct complex queries:

```javascript
// Example updating records based on numeric thresholds and logical operators
const result = await usersHandler.update({
    set: {
        status: 'inactive'
    },
    where: [
        { age: 18, operator: '<' },
        'AND',
        { status: 'active' }
    ]
});
// Executes: UPDATE users SET `status` = ? WHERE `age` < ? AND `status` = ?

// Example updating records using automatic IN operator detection
const result = await usersHandler.update({
    set: {
        role: 'archived'
    },
    where: [
        { id: [10, 20, 30] } // Automatically builds: WHERE `id` IN (?, ?, ?)
    ]
});
// Executes: UPDATE users SET `role` = ? WHERE `id` IN (?, ?, ?)

// Example combining complex logic (AND/OR)
const result = await usersHandler.update({
    set: {
        category: 'Premium'
    },
    where: [
        { total_purchases: 1000, operator: '>' },
        'AND',
        { status: 'active' },
        'OR',
        { is_vip: 1 }
    ]
});
// Executes: UPDATE users SET `category` = ? WHERE `total_purchases` > ? AND `status` = ? OR `is_vip` = ?
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

## jQuery DataTables Server-Side Support (`selectToDatatable`)

The `selectToDatatable` method provides seamless, enterprise-grade, high-performance integration with [jQuery DataTables](https://datatables.net/) server-side processing. It eliminates manual SQL pagination boilerplate, automatically handling pagination, search (global and column-specific), multi-column ordering, regex filters, dual-count latency optimizations, backend security constraints, Soft Deletes, and sensitive field masking.

---

### Step-by-Step Execution Lifecycle (Under the Hood)

Whenever `selectToDatatable(rawDtQuery, strictCondition)` is invoked, it executes the following optimized workflow:

```
[Incoming Request] (req.body or req.query)
        │
        ▼
1. Hydration & Security Filter
   • Flattens or parses bracketed keys (e.g. columns[0][data] -> { columns: [{ data: ... }] })
   • Prototype Pollution Guard: Sanitizes __proto__, constructor, and prototype (CWE-1321)
   • Sanitizes integers (draw, start, length) preventing NaN injections
        │
        ▼
2. Backend Security & Tenant Scoping (strictCondition)
   • Injects non-bypassable backend filters (tenant_id, account_id, branch, etc.)
   • [v2.0.0] Injects Soft Delete filter (deletado_em IS NULL) automatically unless withTrashed() is active
        │
        ▼
3. Search Clause Generation
   • Global Search (search.value): Checks all columns where searchable == true -> (col1 LIKE ? OR col2 LIKE ?)
   • Column-Specific Search (columns[i].search.value): Checks individual columns -> AND colN LIKE ?
   • Regex Toggle: If regex == true, switches operator from LIKE %term% to REGEXP term
   • Parameterized bindings: All terms use prepared statement placeholders (?) to block SQL injection
        │
        ▼
4. Dual-COUNT Latency Optimization
   • No Active Search Filter: Only 1 COUNT(*) query is executed. recordsFiltered is instantly set to recordsTotal (up to 50% database I/O reduction).
   • Active Search Filter: Executes total COUNT(*) and filtered COUNT(*) concurrently via Promise.all().
        │
        ▼
5. Short-Circuit Check
   • If recordsFiltered === 0: The data SELECT query is skipped entirely. Returns data: [] immediately, avoiding expensive filesort and buffer allocations.
        │
        ▼
6. Multi-Column Ordering & Keyset Limitation
   • Parses all order directives (order[0], order[1], etc.)
   • Maps column index to sanitized column name (e.g. `col1` ASC, `col2` DESC)
   • Generates LIMIT start, length safely
        │
        ▼
7. Data Retrieval & Sensitive Field Masking
   • Executes SELECT <columns> FROM <table> [JOINS] [WHERE] [ORDER BY] [LIMIT]
   • [v2.0.0] Strips any fields declared in hiddenFields (e.g. senha_hash, token) before output
        │
        ▼
[Standard JSON Response to DataTables]
```

---

### Key Features & Performance Optimizations

* **Smart Single `COUNT(*)`:** When no client-side search filter is active (the default state during initial page load, sorting, and standard pagination), `recordsFiltered` is automatically set to `recordsTotal`. The method skips the redundant second `COUNT(*)` query, **reducing database count latency and I/O by up to 50%**.
* **Short-Circuit on Zero Results:** If search criteria yield zero records (`recordsFiltered === 0`), the data retrieval query (`SELECT ... LIMIT`) is skipped entirely, returning an empty array `data: []` instantly without triggering expensive `filesort` or index scans.
* **Format & Content-Type Agnostic:** Fully supports both `application/json` (with native JavaScript boolean values `true`/`false`) and `application/x-www-form-urlencoded` (nested or bracket-flattened parameters like `columns[0][data]`).
* **Multi-Column Sorting:** Seamlessly parses multiple order directives (e.g. holding Shift or configuring `order: [[0, 'asc'], [1, 'desc']]`), producing `ORDER BY \`col1\` ASC, \`col2\` DESC`.
* **Safe Qualified Column Identifiers:** Automatically splits table/alias qualified column names (e.g. `u.name`, `p.title`) and escapes each component separately (`` `u`.`name` ``), avoiding MySQL `ER_BAD_FIELD_ERROR` issues when using JOINs.
* **Prototype Pollution Protection (CWE-1321):** Deeply sanitizes incoming request keys, blocking injections targeting `__proto__`, `constructor`, or `prototype`.
* **[v2.0.0] Soft Delete & Hidden Fields Aware:** Automatically excludes soft-deleted records (`deletado_em IS NULL`) and strips sensitive columns (`hiddenFields`) from the returned JSON.

---

### Method Signature

```javascript
await handler.selectToDatatable(rawDtQuery, strictCondition = [])
```

#### Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `rawDtQuery` | `Object` | **Yes** | The request payload sent by jQuery DataTables (`req.body` in POST or `req.query` in GET). Supports both bracket-flattened keys and nested JSON. |
| `strictCondition` | `Array` \| `Object` | No | Backend constraints that the client cannot view or modify (e.g. multi-tenant isolation, user scoping, active-only filters). |

#### DataTables Payload Schema (`rawDtQuery`)

| Field | Type | Description |
| :--- | :--- | :--- |
| `draw` | `number` \| `string` | Draw counter echoed back to the client to ensure response synchronization. |
| `start` | `number` \| `string` | Zero-based paging first record indicator (`OFFSET`). Defaults to `0`. |
| `length` | `number` \| `string` | Number of records to return (`LIMIT`). |
| `search.value` | `string` | Global search value applied across all columns with `searchable: true`. |
| `search.regex` | `boolean` \| `string` | If `true` or `'true'`, uses MySQL `REGEXP` instead of `LIKE %value%`. |
| `order` | `Array<Object>` | Array of order objects: `{ column: 0, dir: 'asc' \| 'desc' }`. |
| `columns` | `Array<Object>` | Array of column definitions: `{ data: 'col_name', searchable: true, orderable: true, search: { value: '', regex: false } }`. |

---

### Basic Express.js Example

```javascript
const express = require('express');
const { db, usersHandler } = require('./databaseController');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.post('/api/users/datatable', async (req, res) => {
    // req.body contains: { draw, start, length, search, order, columns }
    const result = await usersHandler.selectToDatatable(req.body);
    res.json(result);
});
```

---

### Enforcing Backend Security (`strictCondition`)

Never rely on the client frontend to enforce data boundaries. Pass a `strictCondition` array to apply non-bypassable constraints. It shares the same query-building syntax as `select()`, supporting custom operators, arrays (`IN`), and `AND`/`OR` conjunctions:

```javascript
app.post('/api/orders/datatable', async (req, res) => {
    // Client-side parameters cannot bypass these conditions:
    const strictConditions = [
        { tenant_id: req.user.tenantId },
        'AND',
        { status: 'deleted', operator: '!=' },
        'AND',
        { store_id: [101, 102, 105] } // Automatically mapped to: `store_id` IN (?, ?, ?)
    ];

    const result = await ordersHandler.selectToDatatable(req.body, strictConditions);
    res.json(result);
});
```

---

### Using JOINs with DataTables

#### Option A: Modern Fluent Query Builder Joins (Recommended in v2.0.0)
Chain `.selectFields()` and `.leftJoin()` / `.join()` directly with `.selectToDatatable()`:

```javascript
app.post('/api/pedidos/datatable', async (req, res) => {
    const result = await pedidosHandler
        .selectFields([
            'pedidos.id', 
            'pedidos.valor', 
            'pedidos.criado_em',
            { column: 'c.nome', as: 'cliente_nome' },
            { column: 'v.nome', as: 'vendedor_nome' }
        ])
        .leftJoin('clientes c', 'pedidos.cliente_id', '=', 'c.id')
        .leftJoin('vendedores v', 'pedidos.vendedor_id', '=', 'v.id')
        .selectToDatatable(req.body, [
            { 'pedidos.empresa_id': req.user.empresaId }
        ]);

    res.json(result);
});
```

#### Option B: Legacy Expression Parameter
You can also initialize the handler with a SQL expression containing the JOINs and selected columns:

```javascript
// Table: 'sales s'
// Expression: JOIN with customers and users, selecting extra fields
const salesHandler = new DataBaseHandler(
    db, 
    'customers_sales s', 
    ', c.name AS customer_name, u.name AS user_name ' +
    'LEFT JOIN customers c ON c.id = s.customer ' +
    'LEFT JOIN users u ON u.id = s.user'
);

app.post('/api/sales/datatable', async (req, res) => {
    // DataTables columns can search and sort by qualified identifiers (e.g. 'c.name')
    const result = await salesHandler.selectToDatatable(req.body, [
        { 's.deleted_at': null, operator: 'IS' }
    ]);
    res.json(result);
});
```

---

### Soft Deletes & Sensitive Fields in DataTables (v2.0.0)

When configuring business rules on the handler, `selectToDatatable` automatically complies without requiring manual filters:

```javascript
const clientesHandler = new DatabaseHandler(db, 'clientes', {
    softDelete: 'deletado_em',                         // Injeta 'AND deletado_em IS NULL' automaticamente
    hiddenFields: ['senha_hash', 'token_recuperacao'] // Remove do retorno mesmo se 'SELECT *' for usado
});

// A consulta abaixo já ignora excluídos e nunca expõe senha_hash
app.post('/api/clientes/datatable', async (req, res) => {
    const result = await clientesHandler.selectToDatatable(req.body);
    res.json(result);
});

// Para consultar registos da lixeira (soft-deleted):
app.post('/api/clientes/trash/datatable', async (req, res) => {
    const result = await clientesHandler.onlyTrashed().selectToDatatable(req.body);
    res.json(result);
});
```

---

### Frontend jQuery DataTables Setup

Configure your frontend DataTables instance with `serverSide: true`:

```javascript
$('#usersTable').DataTable({
    processing: true,
    serverSide: true,
    ajax: {
        url: '/api/users/datatable',
        type: 'POST',
        contentType: 'application/json',
        data: function (d) {
            return JSON.stringify(d);
        }
    },
    columns: [
        { data: 'id', name: 'id' },
        { data: 'name', name: 'name' },
        { data: 'email', name: 'email' },
        { data: 'role', name: 'role' },
        { 
            data: null, 
            orderable: false, 
            searchable: false,
            render: function (data, type, row) {
                return `<button onclick="editUser(${row.id})">Edit</button>`;
            }
        }
    ],
    order: [[0, 'desc']]
});
```

---

### Response Structure & Error Handling

The method always returns the standard JSON response expected by DataTables:

#### Success Response
```json
{
  "draw": 1,
  "recordsTotal": 1250,
  "recordsFiltered": 45,
  "data": [
    { "id": 42, "name": "John Doe", "email": "john@example.com", "role": "admin" },
    { "id": 43, "name": "Jane Smith", "email": "jane@example.com", "role": "editor" }
  ]
}
```

#### Safe Error Handling
If an underlying database error occurs, `selectToDatatable` catches it safely, notifies your `onError` handler (if configured), and returns a structured response with the error message so the client table does not hang indefinitely:

```json
{
  "draw": 1,
  "recordsTotal": 0,
  "recordsFiltered": 0,
  "data": [],
  "error": "ER_NO_SUCH_TABLE: Table 'my_app_db.invalid_table' doesn't exist"
}
```


---

## Transaction Support (ACID & Transparent)

The library provides first-class transaction support built on top of Node.js native `AsyncLocalStorage`. Transactions can be used explicitly or completely transparently across shared Singletons without manual connection passing.

### 1. Explicit Block (`db.transaction`)

Wrap operations in `db.transaction(callback)`. If the callback resolves, `COMMIT` is executed automatically. If an error is thrown or unhandled, `ROLLBACK` is performed automatically and the connection is safely released back to the pool.

```javascript
await db.transaction(async () => {
    await usersHandler.insert({ name: 'Alice', balance: 500 });
    await auditHandler.insert({ action: 'USER_CREATED', user: 'Alice' });
    // If any error occurs, all operations in this block are rolled back!
});
```

### 2. Singleton Compatibility with `AsyncLocalStorage`

When running inside `db.transaction()`, **you do not need to pass transaction instances to your handlers**. Globally shared table handlers (Singletons) automatically bind to the active transaction of the current asynchronous execution context:

```javascript
// databaseController.js - Exporting global singletons
const db = require('./db-singleton');
const { DataBaseHandler } = require('@areumtecnologia/mysql-db-handler');

const customersSales = new DataBaseHandler(db, 'customers_sales');
const customersProducts = new DataBaseHandler(db, 'customers_products');

module.exports = { db, customersSales, customersProducts };
```

```javascript
// salesRouter.js - In your route handler
const { db, customersSales, customersProducts } = require('./databaseController');

router.post('/sales', async (req, res) => {
    try {
        let saleResult;
        await db.transaction(async () => {
            saleResult = await customersSales.insert(req.body.sale);
            
            // Check stock and update
            const product = (await customersProducts.select([{ id: req.body.productId }]))[0];
            if (!product || product.stock < req.body.amount) {
                // Throwing an error here triggers automatic ROLLBACK for both tables!
                throw new Error('Insufficient product stock');
            }

            await customersProducts.update({
                set: { stock: product.stock - req.body.amount },
                where: { id: req.body.productId }
            });
        });

        res.json(saleResult);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
```

### 3. Post-Commit Hook (`db.onCommit`)

When integrating with external third-party APIs (e.g., banking APIs, payment gateways, invoice generators, SMS, emails), **never perform slow external network calls while holding database locks**.

`db.onCommit(callback)` queues actions that will run **only after the database transaction successfully commits**:

```javascript
await db.transaction(async () => {
    const sale = await customersSales.insert(payload);
    
    // Schedule bank invoice creation: only runs if DB transaction commits!
    db.onCommit(async () => {
        await bankApiClient.registerInvoice(sale.insertId, invoiceData);
    });
});
```

### 4. Route Wrapper (`db.transactional`)

Easily wrap asynchronous route handlers or service functions to run within a transaction without nesting `try/catch` or `db.transaction` boilerplate:

```javascript
router.post('/orders', db.transactional(async (req, res) => {
    const order = await ordersHandler.insert(req.body);
    await itemsHandler.insert({ orderId: order.insertId, items: req.body.items });
    res.json(order);
}));
```

### 5. Express Lazy Middleware (`db.autoTransaction`)

For maximum transparency with **zero lines changed** in your route handlers, enable the `autoTransaction` middleware in your Express app:

```javascript
// server.js / app.js
app.use(db.autoTransaction({
    methods: ['POST', 'PUT', 'DELETE', 'PATCH'], // HTTP methods to protect
    lazy: true // Only opens a transaction when a write operation occurs
}));
```

* **Lazy Allocation:** `GET` requests or routes that only execute `select` queries will not open a transaction or hold connections.
* **On-Demand Write:** As soon as an `insert`, `update`, or `delete` is called on any handler during the request, a dedicated transaction starts automatically.
* **Automatic Completion:** When `res.send()` or `res.json()` completes with HTTP status `< 400`, the transaction automatically commits. If status is `>= 400` or an exception is thrown, it rolls back automatically.

### 6. Nested Transactions & Savepoints

The library natively supports nested transactions using MySQL `SAVEPOINT`s. Calling `db.transaction()` inside an existing transaction creates a savepoint instead of a new connection:

```javascript
await db.transaction(async () => {
    await mainHandler.insert({ status: 'started' });

    try {
        // Nested block runs under a SAVEPOINT
        await db.transaction(async () => {
            await subHandler.insert({ data: 'optional_task' });
            throw new Error('Non-critical sub-task failed');
        });
    } catch (e) {
        // Sub-task is rolled back to SAVEPOINT, but the main transaction can still commit!
        console.warn('Sub-task skipped:', e.message);
    }

    await mainHandler.insert({ status: 'completed' });
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

## High-Scale Enterprise Micro-ORM (v2.0.0)

With **v2.0.0**, `@areumtecnologia/mysql-db-handler` evolves from a single-table CRUD helper into a full-fledged enterprise Data Mapper and Micro-ORM designed for high-throughput, mission-critical systems.

### 1. Fluent Joins & Eager Loading (Eliminating the N+1 Problem)

#### Fluent Joins with Automatic Identifier Sanitization
Chain `.join()`, `.leftJoin()`, `.rightJoin()`, or `.innerJoin()` directly on the query builder with support for table aliases:

```javascript
const pedidos = await pedidosHandler
    .selectFields(['pedidos.id', 'pedidos.valor', { column: 'c.nome', as: 'cliente_nome' }])
    .leftJoin('clientes c', 'pedidos.cliente_id', '=', 'c.id')
    .where('pedidos.status', 'PAGO')
    .get();
```

#### Eager Loading (`.with()`)
Prevent the dreaded N+1 query problem without creating massive, memory-heavy Cartesian joins in MySQL. Child entities are loaded in a single batched `WHERE foreign_key IN (...)` query and hydrated directly onto parents in memory:

```javascript
const pedidosComItens = await pedidosHandler
    .where('status', 'PAGO')
    .with('itens', {
        type: 'hasMany',
        handler: itensHandler,
        foreignKey: 'pedido_id',
        localKey: 'id'
    })
    .with('cliente', DatabaseHandler.belongsTo(clientesHandler, 'cliente_id', 'id'))
    .get();

// pedidosComItens[0].itens -> Array de itens do pedido 1
// pedidosComItens[0].cliente -> Objeto do cliente associado
```

---

### 2. Read/Write Splitting (Master + Read Replicas)

Scale read traffic horizontally across multiple cloud replicas (e.g. AWS Aurora, GCP Cloud SQL, Azure Database for MySQL) with automatic Round-Robin load balancing and strict transactional sticky sessions:

```javascript
const db = new DataBase({
    host: 'primary-master.internal', // Pool de Escrita (Master)
    user: 'app_user',
    password: 'secret_password',
    database: 'meu_banco',
    replicas: [
        { host: 'read-replica-1.internal' },
        { host: 'read-replica-2.internal' }
    ]
});

// Queries simples de leitura são distribuídas via Round-Robin nas réplicas
const users = await db.query('SELECT * FROM users WHERE status = ?', ['active']);

// Operações de mutação (INSERT, UPDATE, DELETE) vão obrigatoriamente para o Master
await db.query('INSERT INTO users SET ?', [{ name: 'Novo Usuário' }], true);

// Dentro de transações, TODAS as leituras e escritas utilizam a conexão Master (evitando replication lag)
await db.transaction(async () => {
    const user = await db.query('SELECT saldo FROM contas WHERE id = ?', [1]);
    await db.query('UPDATE contas SET saldo = saldo - 50 WHERE id = ?', [1], true);
});
```

---

### 3. Keyset Pagination & Memory-Safe Streaming

#### Keyset / Cursor Pagination (`.cursorPaginate()`)
Traditional `OFFSET` pagination degrades significantly on large tables because MySQL must scan and discard all rows before the offset. Keyset pagination uses constant-time index seeks (`WHERE id > ? ORDER BY id ASC LIMIT ?`):

```javascript
// Primeira página
const page1 = await produtosHandler.cursorPaginate({ limit: 20 });
// page1: { data: [...], nextCursor: 20, prevCursor: 1, hasMore: true, limit: 20 }

// Próxima página (tempo constante de 1ms, mesmo após 500.000 registos)
const page2 = await produtosHandler.cursorPaginate({
    limit: 20,
    after: page1.nextCursor
});
```

#### Streaming & Async Iterator (`for await ... of`)
Export millions of rows to CSV or feed an ETL pipeline without triggering Node.js Heap Out of Memory errors:

```javascript
// Iteração sob demanda com consumo constante de memória (< 30 MB)
for await (const row of relatorioHandler.cursor({ batchSize: 1000 })) {
    processRow(row);
}

// Node.js Readable Stream nativo para pipes HTTP ou arquivos
relatorioHandler.stream({ batchSize: 500 })
    .pipe(csvTransformStream)
    .pipe(res);
```

---

### 4. Native Business Rules: Soft Deletes, Timestamps & Lifecycle Hooks

```javascript
const clientesHandler = new DatabaseHandler(db, 'clientes', {
    softDelete: 'deletado_em', // ou boolean true (padrão 'deletado_em')
    timestamps: true          // injeta criado_em e atualizado_em automaticamente
});
```

#### Soft Deletes
* `.delete(where)`: Automaticamente executa `UPDATE clientes SET deletado_em = NOW() WHERE ...`.
* Consultas padrão (`select`, `get`, `first`, `paginate`, `selectToDatatable`) injetam automaticamente `AND deletado_em IS NULL`.
* `.withTrashed()`: Desativa o filtro para retornar registos ativos e deletados.
* `.onlyTrashed()`: Retorna exclusivamente registos na lixeira (`deletado_em IS NOT NULL`).
* `.restore(where)`: Restaura registos setando `deletado_em = NULL`.
* `.forceDelete(where)`: Executa `DELETE FROM` físico no MySQL.

#### Lifecycle Hooks
Intercepte mutações antes ou depois de sua persistência:

```javascript
clientesHandler
    .beforeInsert(async (data) => {
        data.slug = slugify(data.nome);
    })
    .afterInsert(async (result, data) => {
        await logAudit('CLIENT_CREATED', result.insertId);
    })
    .beforeUpdate(async (set, where) => {
        validateBusinessRules(set);
    })
    .afterDelete(async (result, where) => {
        await notifyService(where);
    });
```

---

### 5. Runtime Schema Validation (Auto-Strip) & Sensitive Field Masking

```javascript
const usuariosHandler = new DatabaseHandler(db, 'usuarios', {
    autoStripUnknown: true,                            // Remove propriedades desconhecidas do payload
    hiddenFields: ['senha_hash', 'token_recuperacao'] // Oculta campos confidenciais das consultas
});

// Prevenção de Mass Assignment e ER_BAD_FIELD_ERROR vindo de requisições web:
await usuariosHandler.insert({
    nome: 'Carlos',
    email: 'carlos@empresa.com',
    senha_hash: 'hash_seguro',
    isAdminFake: true,             // Ignorado silenciosamente pois não existe no schema
    payload_sujo: 'qualquer_coisa' // Ignorado silenciosamente
});

// Consultas nunca retornam senha_hash ou token_recuperacao acidentalmente:
const usuario = await usuariosHandler.where('id', 1).first();
console.log(usuario.senha_hash); // undefined
```

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
