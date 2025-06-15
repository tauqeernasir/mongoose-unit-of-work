import { ClientSession, Connection } from "mongoose";
import { DEFAULT_RETRY_OPTIONS, DEFAULT_SESSION_OPTIONS } from "./constants";
import { ILogger, RetryOptions, TransactionFunction } from "./interfaces";
import { UnitOfWork } from "./unit-of-work";

export class ResilientUnitOfWork extends UnitOfWork {
  private retryOptions: RetryOptions;

  constructor(
    connection: Connection,
    options?: {
      retryOptions?: Partial<RetryOptions>;
      logger?: ILogger;
      transactionOptions?: ClientSession["defaultTransactionOptions"];
    }
  ) {
    const transactionOptions = {
      ...DEFAULT_SESSION_OPTIONS,
      ...options?.transactionOptions,
    };

    super(connection, {
      logger: options?.logger,
      transactionOptions,
    });
    this.retryOptions = {
      ...DEFAULT_RETRY_OPTIONS,
      ...options?.retryOptions,
    };
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
