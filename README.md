# Mongoose Unit of Work

A lightweight implementation of the Unit of Work pattern for Mongoose transactions with support for resilient transactions and logging.

## Installation

```bash
npm install mongoose-unit-of-work
```

## Usage

### Basic Usage

```typescript
import mongoose from "mongoose";
import { UnitOfWork } from "mongoose-unit-of-work";

// Create a unit of work instance
const uow = new UnitOfWork(mongoose.connection);

// Execute a transaction
await uow.executeTransaction(async (session, uow) => {
  // Perform your database operations here
  const user = await User.create([{ name: "John" }], { session });
  const order = await Order.create([{ userId: user[0]._id }], { session });

  return { user, order };
});
```

### Resilient Transactions

For handling transient transaction errors with automatic retries:

```typescript
import { ResilientUnitOfWork } from "mongoose-unit-of-work";

// Create a resilient unit of work instance with custom retry options
const uow = new ResilientUnitOfWork(mongoose.connection, {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 1000,
  backoffFactor: 2,
  retryableErrors: [
    "TransientTransactionError",
    "UnknownTransactionCommitResult",
  ],
});

// Execute a transaction with automatic retries
await uow.executeTransaction(async (session, uow) => {
  // Your transaction code here
});
```

## Features

- Simple transaction management
- Automatic session handling
- Error handling with automatic rollback
- TypeScript support
- Built-in logging support
- Resilient transactions with configurable retry options
- Configurable transaction options (read concern, write concern, read preference)

## API

### UnitOfWork

- `begin()`: Start a new transaction
- `commit()`: Commit the current transaction
- `abort()`: Rollback the current transaction
- `dispose()`: Clean up resources
- `executeTransaction<T>(fn)`: Execute a function within a transaction
- `getSession()`: Get the current session
- `execute<T>(fn)`: Execute a function within an existing transaction

### ResilientUnitOfWork

Extends `UnitOfWork` with additional features:

- Automatic retry on transient transaction errors
- Configurable retry options
- Exponential backoff strategy

## Configuration

### Default Transaction Options

```typescript
const DEFAULT_SESSION_OPTIONS = {
  readConcern: "snapshot",
  writeConcern: {
    w: "majority",
    wtimeout: 3000,
  },
  readPreference: "primary",
};
```

### Default Retry Options

```typescript
const DEFAULT_RETRY_OPTIONS = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 1000,
  backoffFactor: 2,
  retryableErrors: [
    "TransientTransactionError",
    "UnknownTransactionCommitResult",
  ],
};
```

## Requirements

- Node.js >= 14
- Mongoose >= 8.15.2

## License

MIT
