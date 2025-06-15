import mongoose, { ClientSession, Connection } from "mongoose";

interface TransactionFunction<T = any> {
  (session: ClientSession, uow: UnitOfWork): Promise<T>;
}

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
