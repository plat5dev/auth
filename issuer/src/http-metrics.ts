import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("issuer.http");

const httpRequestsTotal = meter.createCounter("http_requests_total", {
  description: "Total HTTP requests processed",
});

const httpRequestDuration = meter.createHistogram("http_request_duration_seconds", {
  description: "HTTP request duration in seconds",
  unit: "s",
  advice: {
    explicitBucketBoundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  },
});

function normalizeRoute(pathname: string): string {
  if (pathname.startsWith("/.well-known/")) {
    return pathname;
  }

  const providerMatch = pathname.match(/^\/([a-z]+)\/(authorize|callback|verify)$/);
  if (providerMatch) {
    return `/{provider}/${providerMatch[2]}`;
  }

  const coreRoutes = ["/authorize", "/token", "/callback", "/userinfo", "/revoke"];
  if (coreRoutes.includes(pathname)) {
    return pathname;
  }

  return pathname.length > 50 ? pathname.slice(0, 50) : pathname;
}

export type FetchHandler = (request: Request, server?: unknown) => Promise<Response>;

export function withHttpMetrics(handler: FetchHandler): FetchHandler {
  return async (request: Request, server?: unknown): Promise<Response> => {
    const start = performance.now();
    const method = request.method;

    let route: string;
    try {
      const url = new URL(request.url);
      route = normalizeRoute(url.pathname);
    } catch {
      const rawUrl = request.url ?? "";
      route = normalizeRoute(rawUrl.startsWith("/") ? (rawUrl.split("?")[0] as string) : "unknown");
    }

    try {
      const response = await handler(request, server);
      const durationSeconds = (performance.now() - start) / 1000;
      const status = String(response.status);

      httpRequestsTotal.add(1, { method, route, status });
      httpRequestDuration.record(durationSeconds, { method, route });

      return response;
    } catch (error) {
      const durationSeconds = (performance.now() - start) / 1000;

      httpRequestsTotal.add(1, { method, route, status: "500" });
      httpRequestDuration.record(durationSeconds, { method, route });

      throw error;
    }
  };
}
