# mysql-db-handler

A powerful MySQL wrapper with connection pooling, singleton support, and advanced query handling for Node.js.

## Features

*   **Connection Pooling:** Efficiently manages database connections.
*   **Promise-based:** Fully supports `async/await` for clean code.
*   **Table Handler:** An abstraction layer to perform CRUD operations easily.
*   **Datatables Integration:** Built-in helper to parse and query data specifically for jQuery Datatables server-side processing.
*   **Singleton Support:** Includes a singleton pattern setup for easy global access.

## Installation

```bash
npm install mysql-db-handler
```

## Basic Usage

### 1. Initialize Connection
You can create a new instance of the database class directly.

```javascript
const { DataBase } = require('mysql-db-handler');

const db = new DataBase({
    host: 'localhost',
    user: 'root',
    password: 'password',
    database: 'my_app_db',
    port: 3306,
    connectionLimit: 10
});
```

### 2. Executing Raw SQL
Use the `query` method to execute standard SQL.

```javascript
try {
    const rows = await db.query('SELECT * FROM users WHERE active = ?', [1]);
    console.log(rows);
} catch (error) {
    console.error(error);
}
```

### 3. Using the DataBaseHandler
The `DataBaseHandler` simplifies interactions with specific tables.

```javascript
const { DataBaseHandler } = require('mysql-db-handler');

// Initialize handler for 'customers' table
const customers = new DataBaseHandler(db, 'customers');

// Select all
const allCustomers = await customers.select();

// Select with conditions
const activeCustomers = await customers.selectBy({ status: 1 });
```

---

## Advanced Usage & Examples

### Flexible Selection (`select`)

The `select` method allows you to build complex queries using an array of parameters and a clauses object.

**Parameters:**
*   `params` (Array): An array where each element is either a condition object or a logical string ('AND', 'OR').
    *   Simple condition: `{ column: value }` (defaults to `=`)
    *   Condition with operator: `{ column: value, operator: '>' }`
*   `clauses` (Object): Optional keys like `ORDERBY`, `DESC`, `LIMIT`, `OFFSET`, `GROUP BY`, `HAVING`.

**Example:**

```javascript
const products = new DataBaseHandler(db, 'products');

const results = await products.select(
    // 1. Params: Conditions
    [
        { category: 'electronics' },    // WHERE `category` = 'electronics'
        'AND',
        { price: 1000, operator: '>' }  // AND `price` > 1000
    ],
    // 2. Clauses: SQL Modifiers
    {
        'ORDERBY': 'price',
        'DESC': true,
        'LIMIT': 10,
        'OFFSET': 0
    }
);
```

### Updating Records (`update`)

The `update` method separates the values to change from the conditions.

**Parameters:**
*   `params` (Object): Contains:
    *   `set`: Key-value pairs of columns to update.
    *   `where`: Key-value pairs for the WHERE clause (uses `AND` implicitly between keys).
*   `options` (Object): Optional settings, e.g., `{ useRegex: true }` to use REGEXP instead of =.

**Example:**

```javascript
const users = new DataBaseHandler(db, 'users');

const result = await users.update({
    set: {
        status: 'inactive',
        last_seen: new Date()
    },
    where: {
        id: 123,
        role: 'guest'
    }
});
// Executes: UPDATE users SET `status` = ?, `last_seen` = ? WHERE `id` = ? AND `role` = ?
```

### Deleting Records (`delete`)

The `delete` method removes rows matching the provided conditions.

**Parameters:**
*   `conditions` (Object): Key-value pairs to match rows to delete (uses `AND` implicitly).

**Example:**

```javascript
const sessions = new DataBaseHandler(db, 'user_sessions');

const result = await sessions.delete({
    user_id: 55,
    is_expired: 1
});
// Executes: DELETE FROM user_sessions WHERE `user_id` = ? AND `is_expired` = ?
```

---

## API Documentation

### Class: `DataBase`

#### `constructor(config)`
Creates a database instance with a connection pool.
*   **config**: Object. MySQL2 connection configuration (host, user, password, database, port, connectionLimit, etc).

#### `async query(sql, params)`
Executes a SQL query using a pooled connection.
*   **sql**: String. The SQL query to execute.
*   **params**: Array. Parameters for the prepared statement.
*   **Returns**: `Promise<Array|Object>`. Returns rows on success, or an error object if failed.

#### `async close()`
Closes the connection pool completely.
*   **Returns**: `Promise<void>`.

---

### Class: `DataBaseHandler`

#### `constructor(database, table, expression)`
*   **database**: Instance of `DataBase`.
*   **table**: String. The name of the table.
*   **expression**: String (Optional). Additional SQL expression (e.g., extra columns or joins).

#### `async select(params, clauses)`
See "Flexible Selection" above.
*   **Returns**: `Promise<Array>`.

#### `async selectBy(params)`
Quickly select rows matching a specific object condition.
*   **params**: Object. Key-value pairs for WHERE clause (e.g., `{ id: 5 }`).
*   **Returns**: `Promise<Array>`.

#### `async insert(params)`
Inserts a new row.
*   **params**: Object. Key-value pairs representing column names and values.
*   **Returns**: `Promise<OkPacket>` (contains insertId, affectedRows, etc).

#### `async update(params, options)`
See "Updating Records" above.
*   **Returns**: `Promise<OkPacket>`.

#### `async delete(conditions)`
See "Deleting Records" above.
*   **Returns**: `Promise<OkPacket>`.

#### `async selectToDatatable(rawDtQuery, strictCondition)`
Helper for server-side Datatables.net processing.
*   **rawDtQuery**: Object. The request object sent by Datatables.
*   **strictCondition**: Array. Additional strict WHERE clauses not controlled by the frontend.
*   **Returns**: Object. Format expected by Datatables `{ draw, recordsTotal, recordsFiltered, data }`.

---

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

1.  Fork the repository
2.  Create your feature branch (`git checkout -b feature/amazing-feature`)
3.  Commit your changes (`git commit -m 'Add some amazing feature'`)
4.  Push to the branch (`git push origin feature/amazing-feature`)
5.  Open a Pull Request

## License

MIT