import { ClientSession } from "mongoose";
import { RetryOptions } from "./interfaces";

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 1000,
  backoffFactor: 2,
  retryableErrors: [
    "TransientTransactionError",
    "UnknownTransactionCommitResult",
  ],
};

export const DEFAULT_SESSION_OPTIONS: ClientSession["defaultTransactionOptions"] =
  {
    readConcern: "snapshot",
    writeConcern: {
      w: "majority",
      wtimeout: 3000,
    },
    readPreference: "primary",
  };
