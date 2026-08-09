import { context, trace } from "@opentelemetry/api";

const defaultScope = "issuer";

type AttributeValue = string | number | boolean;
type AttributeInput = AttributeValue | AttributeValue[] | null | undefined;
type AttributeRecord = Record<string, AttributeInput>;
type LogLevel = "debug" | "info" | "warn" | "error";

export interface StructuredLogger {
  debug(message: string, attributes?: AttributeRecord): void;
  info(message: string, attributes?: AttributeRecord): void;
  warn(message: string, attributes?: AttributeRecord): void;
  error(message: string, error?: unknown, attributes?: AttributeRecord): void;
  withScope(scopeSuffix: string, attributes?: AttributeRecord): StructuredLogger;
}

const consoleWriters: Record<LogLevel, (line: string) => void> = {
  debug: (line) => console.debug(line),
  info: (line) => console.log(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

export const logger = createLogger(defaultScope);

export function createLogger(scope: string, baseAttributes: AttributeRecord = {}): StructuredLogger {
  return new JsonLogger(scope, baseAttributes);
}

class JsonLogger implements StructuredLogger {
  constructor(
    private readonly scope: string,
    private readonly baseAttributes: AttributeRecord = {},
  ) {}

  withScope(scopeSuffix: string, attributes: AttributeRecord = {}) {
    const nextScope = scopeSuffix ? `${this.scope}.${scopeSuffix}` : this.scope;
    return new JsonLogger(nextScope, { ...this.baseAttributes, ...attributes });
  }

  debug(message: string, attributes?: AttributeRecord) {
    emitLog(this.scope, "debug", message, this.baseAttributes, attributes);
  }

  info(message: string, attributes?: AttributeRecord) {
    emitLog(this.scope, "info", message, this.baseAttributes, attributes);
  }

  warn(message: string, attributes?: AttributeRecord) {
    emitLog(this.scope, "warn", message, this.baseAttributes, attributes);
  }

  error(message: string, error?: unknown, attributes?: AttributeRecord) {
    emitLog(this.scope, "error", message, this.baseAttributes, attributes, error);
  }
}

function emitLog(
  scope: string,
  level: LogLevel,
  message: string,
  baseAttributes: AttributeRecord,
  attributes?: AttributeRecord,
  error?: unknown,
) {
  const mergedAttributes: AttributeRecord = { ...baseAttributes, ...attributes };

  const span = trace.getSpan(context.active());
  if (span) {
    const spanContext = span.spanContext();
    mergedAttributes["trace_id"] = spanContext.traceId;
    mergedAttributes["span_id"] = spanContext.spanId;
  }

  if (error instanceof Error) {
    // Closed set only — never fall back to Error.name (e.g. "Error").
    mergedAttributes["error_kind"] ??= "internal";
    mergedAttributes["error_message"] ??= error.message;
  }

  const payload: AttributeRecord = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    ...mergedAttributes,
    ...(error instanceof Error
      ? { stack: error.stack }
      : error !== undefined
        ? { error: String(error) }
        : {}),
  };

  consoleWriters[level](JSON.stringify(payload));
}
