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

interface ILogger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

class DefaultLogger implements ILogger {
  debug(message: string, ...args: any[]): void {
    console.debug(message, ...args);
  }
  info(message: string, ...args: any[]): void {
    console.info(message, ...args);
  }
  warn(message: string, ...args: any[]): void {
    console.warn(message, ...args);
  }
  error(message: string, ...args: any[]): void {
    console.error(message, ...args);
  }
}

const DEFAULT_SESSION_OPTIONS: ClientSession["defaultTransactionOptions"] = {
  readConcern: "snapshot",
  writeConcern: {
    w: "majority",
    wtimeout: 3000,
  },
  readPreference: "primary",
};

export class UnitOfWork {
  private connection: Connection;
  private session: ClientSession | null = null;
  private transactionOptions:
    | ClientSession["defaultTransactionOptions"]
    | null = null;
  protected logger: ILogger;

  constructor(connection: Connection, logger?: ILogger) {
    this.connection = connection || mongoose.connection;
    this.logger = logger || new DefaultLogger();
  }

  async begin(): Promise<UnitOfWork> {
    if (this.session) {
      this.logger.warn("A session is already active");
      throw new Error("A session is already active");
    }

    this.logger.debug("Starting new transaction session");
    this.session = await this.connection.startSession({
      defaultTransactionOptions:
        this.transactionOptions || DEFAULT_SESSION_OPTIONS,
    });
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
      this.logger.warn("No active transaction. Call begin() first.");
      throw new Error("No active transaction. Call begin() first.");
    }

    try {
      this.logger.debug("Executing transaction function");
      const result = await transactionFn(this.session, this);
      return result;
    } catch (error) {
      this.logger.error("Error executing transaction", error);
      throw error;
    }
  }

  async commit(): Promise<void> {
    if (!this.session || !this.session.inTransaction()) {
      return;
    }

    try {
      this.logger.debug("Committing transaction");
      await this.session.commitTransaction();
      this.logger.info("Transaction committed successfully");
    } catch (error) {
      this.logger.error("Error committing transaction", error);
      await this.abort();
      throw error;
    }
  }

  async abort(): Promise<void> {
    if (!this.session || !this.session.inTransaction()) {
      return;
    }

    try {
      this.logger.debug("Aborting transaction");
      await this.session.abortTransaction();
      this.logger.info("Transaction aborted successfully");
    } catch (error) {
      this.logger.error("Error aborting transaction", error);
    }
  }

  async dispose(): Promise<void> {
    if (!this.session) {
      return;
    }

    this.logger.debug("Disposing transaction session");
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
      this.logger.debug("Starting transaction execution");
      await this.begin();
      const result = await this.execute(transactionFn);
      await this.commit();
      this.logger.info("Transaction executed successfully");
      return result;
    } catch (error) {
      this.logger.error("Transaction execution failed", error);
      await this.abort();
      throw error;
    } finally {
      await this.dispose();
    }
  }
}

export class ResilientUnitOfWork extends UnitOfWork {
  private retryOptions: RetryOptions;

  constructor(
    connection: Connection,
    retryOptions?: Partial<RetryOptions>,
    logger?: ILogger
  ) {
    super(connection, logger);
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
        if (attempt > 0) {
          this.logger.info(
            `Retry attempt ${attempt} of ${this.retryOptions.maxRetries}`
          );
        }
        return await super.executeTransaction(transactionFn);
      } catch (error) {
        lastError = error;

        if (
          attempt === this.retryOptions.maxRetries ||
          !this.isRetryableError(error)
        ) {
          this.logger.error(`Transaction failed after ${attempt} retries`, {
            error,
            maxRetries: this.retryOptions.maxRetries,
          });
          throw error;
        }

        const delayMs = this.calculateBackoffDelay(attempt);
        this.logger.warn(`Retryable error occurred, retrying in ${delayMs}ms`, {
          error,
          attempt,
          nextAttempt: attempt + 1,
        });
        await this.delay(delayMs);
      }
    }

    throw lastError;
  }
}
