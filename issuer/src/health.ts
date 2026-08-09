import { logger } from "./logger.ts";
import { collectMetricsText } from "./telemetry.ts";
import type { UsersStore } from "./db/users.ts";
import type { PostgresStorage } from "./storage/postgres.ts";

const healthLogger = logger.withScope("health");
const startTime = Date.now();

interface HealthCheck {
  postgres_ready?: boolean;
}

interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  uptime_ms: number;
  checks: HealthCheck;
}

export interface HealthDeps {
  storage: PostgresStorage;
  users: UsersStore;
}

async function checkPostgres(deps: HealthDeps): Promise<boolean> {
  try {
    await deps.users.ping();
    await deps.storage.get(["__health_check__"]);
    return true;
  } catch {
    return false;
  }
}

async function getHealthResponse(deps: HealthDeps): Promise<HealthResponse> {
  const postgresReady = await checkPostgres(deps);

  return {
    status: postgresReady ? "healthy" : "unhealthy",
    uptime_ms: Date.now() - startTime,
    checks: {
      postgres_ready: postgresReady,
    },
  };
}

function getLiveResponse(): HealthResponse {
  return {
    status: "healthy",
    uptime_ms: Date.now() - startTime,
    checks: {},
  };
}

export function startHealthServer(port: number, deps: HealthDeps) {
  const server = Bun.serve({
    port,
    fetch: async (request) => {
      const url = new URL(request.url);

      if (url.pathname === "/health/live") {
        const health = getLiveResponse();
        return new Response(JSON.stringify(health), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.pathname === "/health/ready") {
        const health = await getHealthResponse(deps);
        const status = health.status === "healthy" ? 200 : 503;
        return new Response(JSON.stringify(health), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.pathname === "/metrics") {
        const body = await collectMetricsText();
        return new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
          },
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  healthLogger.info("Health server started", { port: server.port });
  return server;
}
