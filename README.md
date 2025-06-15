# Mongoose Unit of Work

A lightweight implementation of the Unit of Work pattern for Mongoose transactions.

## Installation

```bash
npm install mongoose-unit-of-work
```

## Usage

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

## Features

- Simple transaction management
- Automatic session handling
- Error handling with automatic rollback
- TypeScript support

## API

- `begin()`: Start a new transaction
- `commit()`: Commit the current transaction
- `abort()`: Rollback the current transaction
- `dispose()`: Clean up resources
- `executeTransaction<T>(fn)`: Execute a function within a transaction - should be used for most cases as it handles transactions automatically.

## License

MIT
