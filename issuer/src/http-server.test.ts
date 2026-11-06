import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import { served } from "./http-server.ts";

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  );
});

describe("served", () => {
  let lines: Record<string, unknown>[] = [];
  let spy: ReturnType<typeof spyOn>;
  beforeEach(() => {
    exporter.reset();
    lines = [];
    spy = spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      lines.push(JSON.parse(String(chunk)));
      return true;
    });
  });
  afterEach(() => spy.mockRestore());

  const ok = (status: number) => async () => new Response(null, { status });
  const failed = () => new Response(null, { status: 500 });

  test("a matched route: span name and attributes, url.query redacted, an info request line", async () => {
    const request = new Request(
      "http://localhost:5401/authorize?client_id=plat5&X-Amz-Signature=s3cr3t",
      { headers: { traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01" } },
    );
    const response = await served(request, "req-1", ok(302), failed);
    expect(response.status).toBe(302);

    const [span] = exporter.getFinishedSpans();
    expect(span?.name).toBe("GET /authorize");
    expect(span?.spanContext().traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(span?.attributes).toEqual({
      "http.request.method": "GET",
      "url.path": "/authorize",
      "url.scheme": "http",
      "url.query": "client_id=plat5&X-Amz-Signature=REDACTED",
      "http.route": "/authorize",
      request_id: "req-1",
      "http.response.status_code": 302,
    });
    expect(span?.status.code).toBe(0);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "info",
      message: "request completed",
      request_id: "req-1",
      route: "/authorize",
      method: "GET",
      status: 302,
      trace_id: "0af7651916cd43dd8448eb211c80319c",
    });
    expect(lines[0]).not.toHaveProperty("error_type");
    expect(JSON.stringify(lines)).not.toContain("s3cr3t");
  });

  test("an unmatched path: span named by its method, no http.route, no url.query without a query", async () => {
    await served(new Request("http://localhost:5401/wp-login.php"), "req-2", ok(404), failed);
    const [span] = exporter.getFinishedSpans();
    expect(span?.name).toBe("GET");
    expect(span?.attributes).not.toHaveProperty("http.route");
    expect(span?.attributes).not.toHaveProperty("url.query");
    expect(span?.attributes).not.toHaveProperty("error.type");
    expect(span?.status.code).toBe(0);
    expect(lines[0]).toMatchObject({ level: "info", route: "unmatched", status: 404 });
  });

  test("a 5xx response: error.type and Error status without a description, an error line", async () => {
    await served(new Request("http://localhost:5401/token", { method: "POST" }), "r", ok(503), failed);
    const [span] = exporter.getFinishedSpans();
    expect(span?.attributes["error.type"]).toBe("internal");
    expect(span?.status).toEqual({ code: 2 });
    expect(lines[0]).toMatchObject({
      level: "error",
      message: "request completed",
      status: 503,
      error_type: "internal",
    });
    expect(lines[0]).not.toHaveProperty("error_message");
  });

  test("a throw: the fallback 500, the exception on the span, a request failed line", async () => {
    const response = await served(
      new Request("http://localhost:5401/token", { method: "POST" }),
      "r",
      async () => {
        throw new Error("db down");
      },
      failed,
    );
    expect(response.status).toBe(500);
    const [span] = exporter.getFinishedSpans();
    expect(span?.attributes["error.type"]).toBe("internal");
    expect(span?.events.map((e) => e.name)).toEqual(["exception"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "error",
      message: "request failed",
      status: 500,
      error_type: "internal",
      error_message: "db down",
    });
  });
});
