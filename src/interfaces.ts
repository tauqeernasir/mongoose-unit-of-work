import { ClientSession } from "mongoose";
import { UnitOfWork } from "./unit-of-work";

export interface RetryOptions {
  // Maximum number of retry attempts
  maxRetries: number;
  // Initial delay between retries in milliseconds
  initialDelayMs: number;
  // Maximum delay cap in milliseconds
  maxDelayMs: number;
  // Multiplier for exponential backoff
  backoffFactor: number;
  // List of error types to retry on
  retryableErrors?: string[];
}

export interface ILogger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}

export interface TransactionFunction<T = any> {
  (session: ClientSession, uow: UnitOfWork): Promise<T>;
}
