import { context, propagation, trace, SpanKind, SpanStatusCode } from "@opentelemetry/api";

import { ErrorType } from "./errors.ts";
import { normalizeRoute } from "./http-metrics.ts";
import { logger } from "./logger.ts";
import { redactQuery } from "./redact.ts";

const tracer = trace.getTracer("issuer.http");

const headerGetter = {
  keys: (headers: Headers) => [...headers.keys()],
  get: (headers: Headers, key: string) => headers.get(key) ?? undefined,
};

/**
 * Runs one request in its HTTP server span (Plat5's telemetry contract, HTTP
 * server spans) and writes its request line. A thrown error is a 500, from
 * `failed`.
 */
export function served(
  request: Request,
  requestId: string,
  handle: () => Promise<Response>,
  failed: () => Response,
): Promise<Response> {
  const start = performance.now();
  const url = new URL(request.url);
  const method = request.method;
  const route = normalizeRoute(url.pathname);
  const matched = route !== "unmatched";
  const parent = propagation.extract(context.active(), request.headers, headerGetter);
  const query = url.search.slice(1);

  return tracer.startActiveSpan(
    matched ? `${method} ${route}` : method,
    {
      kind: SpanKind.SERVER,
      attributes: {
        "http.request.method": method,
        "url.path": url.pathname,
        "url.scheme": url.protocol.slice(0, -1),
        ...(query ? { "url.query": redactQuery(query) } : {}),
        ...(matched ? { "http.route": route } : {}),
        request_id: requestId,
      },
    },
    parent,
    async (span) => {
      let response: Response;
      let thrown: unknown;
      try {
        response = await handle();
      } catch (error) {
        thrown = error;
        span.recordException(error instanceof Error ? error : String(error));
        response = failed();
      }
      const status = response.status;
      span.setAttribute("http.response.status_code", status);
      const line = {
        request_id: requestId,
        route,
        method,
        status,
        duration_ms: performance.now() - start,
      };
      if (status >= 500) {
        span.setAttribute("error.type", ErrorType.Internal);
        span.setStatus({ code: SpanStatusCode.ERROR });
        logger.error(
          thrown === undefined ? "request completed" : "request failed",
          thrown,
          { ...line, error_type: ErrorType.Internal },
        );
      } else {
        logger.info("request completed", line);
      }
      span.end();
      return response;
    },
  );
}

