import { context, trace } from "@opentelemetry/api";

import { markErrorLogged } from "./errors.ts";

type AttributeValue = string | number | boolean;
type AttributeInput = AttributeValue | AttributeValue[] | null | undefined;
type AttributeRecord = Record<string, AttributeInput>;
type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * One JSON line on stdout per call, with the fields of Plat5's telemetry
 * contract (docs/telemetry.md): timestamp, level, message, then the line's own.
 */
export interface StructuredLogger {
  debug(message: string, attributes?: AttributeRecord): void;
  info(message: string, attributes?: AttributeRecord): void;
  warn(message: string, attributes?: AttributeRecord): void;
  /**
   * An error line. A given error adds `error_type` (`internal` unless the
   * attributes say otherwise), `error_message`, and an exception's `stack`.
   */
  error(message: string, error?: unknown, attributes?: AttributeRecord): void;
}

export const logger: StructuredLogger = {
  debug: (message, attributes) => emit("debug", message, attributes),
  info: (message, attributes) => emit("info", message, attributes),
  warn: (message, attributes) => emit("warn", message, attributes),
  error: (message, error, attributes) => {
    if (error instanceof Error) markErrorLogged(error);
    emit("error", message, attributes, error);
  },
};

function emit(level: LogLevel, message: string, attributes?: AttributeRecord, error?: unknown) {
  const line: AttributeRecord = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...attributes,
  };

  const spanContext = trace.getSpan(context.active())?.spanContext();
  if (spanContext && trace.isSpanContextValid(spanContext)) {
    line["trace_id"] = spanContext.traceId;
    line["span_id"] = spanContext.spanId;
  }

  if (error !== undefined) {
    line["error_type"] ??= "internal";
    line["error_message"] ??= error instanceof Error ? error.message : String(error);
    if (error instanceof Error) {
      line["stack"] = error.stack;
    }
  }

  process.stdout.write(`${JSON.stringify(line)}\n`);
}
