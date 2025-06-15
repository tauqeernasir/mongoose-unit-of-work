import mongoose, { ClientSession, Connection } from "mongoose";
import { DEFAULT_SESSION_OPTIONS } from "./constants";
import { DefaultLogger } from "./default-logger";
import { ILogger, TransactionFunction } from "./interfaces";

export class UnitOfWork {
  private connection: Connection;
  private session: ClientSession | null = null;
  private transactionOptions: ClientSession["defaultTransactionOptions"];
  protected logger: ILogger;

  constructor(
    connection: Connection,
    options?: {
      transactionOptions?: ClientSession["defaultTransactionOptions"];
      logger?: ILogger;
    }
  ) {
    this.connection = connection || mongoose.connection;
    this.logger = options?.logger || new DefaultLogger();
    this.transactionOptions = {
      ...DEFAULT_SESSION_OPTIONS,
      ...options?.transactionOptions,
    };
  }

  async begin(): Promise<UnitOfWork> {
    if (this.session) {
      this.logger.warn("A session is already active");
      throw new Error("A session is already active");
    }

    this.logger.debug("Starting new transaction session");
    this.session = await this.connection.startSession({
      defaultTransactionOptions: this.transactionOptions,
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
