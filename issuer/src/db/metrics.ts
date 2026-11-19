import { metrics, type Counter, type Histogram } from "@opentelemetry/api";
import {
  ATTR_DB_NAMESPACE,
  ATTR_DB_OPERATION_NAME,
  ATTR_DB_SYSTEM_NAME,
} from "@opentelemetry/semantic-conventions";

import { SCHEMA } from "./pool.ts";

export interface DbMetrics {
  operationCounter: Counter;
  operationErrorCounter: Counter;
  operationDuration: Histogram;
}

const DURATION_BUCKETS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1];

/**
 * Shared DB metric instruments on a single meter so PostgresStorage and
 * UsersStore emit one unified Prometheus metric family per metric name.
 * Must be called after `startTelemetry()` so it binds to the active MeterProvider.
 */
export function createDbMetrics(): DbMetrics {
  const meter = metrics.getMeter("issuer.db");
  return {
    operationCounter: meter.createCounter("db_operations_total", {
      description: "Total database operations executed by issuer",
    }),
    operationErrorCounter: meter.createCounter("db_operation_errors_total", {
      description: "Total failed database operations executed by issuer",
    }),
    operationDuration: meter.createHistogram("db_operation_duration_seconds", {
      description: "Duration of database operations executed by issuer",
      unit: "s",
      advice: {
        explicitBucketBoundaries: DURATION_BUCKETS,
      },
    }),
  };
}

export function dbMetricAttributes(operation: string, namespace: string = SCHEMA) {
  return {
    [ATTR_DB_SYSTEM_NAME]: "postgresql",
    [ATTR_DB_OPERATION_NAME]: operation,
    [ATTR_DB_NAMESPACE]: namespace,
  };
}
