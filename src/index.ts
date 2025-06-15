import mongoose, { ClientSession, Connection } from "mongoose";

interface TransactionFunction<T = any> {
  (session: ClientSession, uow: UnitOfWork): Promise<T>;
}

interface RetryOptions {
  maxRetries: number; // Maximum number of retry attempts
  initialDelayMs: number; // Initial delay between retries in milliseconds
  maxDelayMs: number; // Maximum delay cap in milliseconds
  backoffFactor: number; // Multiplier for exponential backoff
  retryableErrors?: string[]; // List of error types to retry on
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 1000,
  backoffFactor: 2,
  retryableErrors: [
    "TransientTransactionError",
    "UnknownTransactionCommitResult",
  ],
};

export class UnitOfWork {
  private connection: Connection;
  private session: ClientSession | null = null;

  constructor(connection: Connection) {
    this.connection = connection || mongoose.connection;
  }

  async begin(): Promise<UnitOfWork> {
    if (this.session) {
      throw new Error("A session is already active");
    }

    this.session = await this.connection.startSession();
    this.session.startTransaction();
    return this;
  }

  getSession(): ClientSession {
    if (!this.session) {
      throw new Error("No active transaction. Call begin() first.");
    }
    return this.session;
  }

  async execute<T>(transactionFn: TransactionFunction<T>): Promise<T> {
    if (!this.session) {
      throw new Error("No active transaction. Call begin() first.");
    }

    try {
      const result = await transactionFn(this.session, this);
      return result;
    } catch (error) {
      throw error;
    }
  }

  async commit(): Promise<void> {
    if (!this.session || !this.session.inTransaction()) {
      return;
    }

    try {
      await this.session.commitTransaction();
    } catch (error) {
      await this.abort();
      throw error;
    }
  }

  async abort(): Promise<void> {
    if (!this.session || !this.session.inTransaction()) {
      return;
    }

    try {
      await this.session.abortTransaction();
    } catch (error) {
      //
    }
  }

  async dispose(): Promise<void> {
    if (!this.session) {
      return;
    }

    await this.session.endSession();
    this.session = null;
  }

  /**
   * Execute a transaction and handle errorr. Use this method to execute a transaction without manually calling begin, commit, and abort.
   * @param transactionFn - The function to execute within the transaction
   * @returns The result of the transaction function
   * @throws Error if the transaction fails
   */
  async executeTransaction<T>(
    transactionFn: TransactionFunction<T>
  ): Promise<T> {
    try {
      await this.begin();
      const result = await this.execute(transactionFn);
      await this.commit();
      return result;
    } catch (error) {
      await this.abort();
      throw error;
    } finally {
      await this.dispose();
    }
  }
}

export class ResilientUnitOfWork extends UnitOfWork {
  private retryOptions: RetryOptions;

  constructor(connection: Connection, retryOptions?: Partial<RetryOptions>) {
    super(connection);
    this.retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...retryOptions };
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isRetryableError(error: any): boolean {
    if (!this.retryOptions.retryableErrors) return false;
    return this.retryOptions.retryableErrors.some(
      (errorType) =>
        error.name === errorType || error.message?.includes(errorType)
    );
  }

  private calculateBackoffDelay(retryCount: number): number {
    const delay = Math.min(
      this.retryOptions.initialDelayMs *
        Math.pow(this.retryOptions.backoffFactor, retryCount),
      this.retryOptions.maxDelayMs
    );
    return delay;
  }

  async executeTransaction<T>(
    transactionFn: TransactionFunction<T>
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 0; attempt <= this.retryOptions.maxRetries; attempt++) {
      try {
        return await super.executeTransaction(transactionFn);
      } catch (error) {
        lastError = error;

        if (
          attempt === this.retryOptions.maxRetries ||
          !this.isRetryableError(error)
        ) {
          throw error;
        }

        const delayMs = this.calculateBackoffDelay(attempt);
        await this.delay(delayMs);
      }
    }

    throw lastError;
  }
}
