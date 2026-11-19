import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { createHealthHandler } from "./health.ts";

describe("createHealthHandler", () => {
  let stdoutSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  test("/health/live returns 200 healthy", async () => {
    const handler = createHealthHandler({ checkReady: async () => {} });
    const res = await handler(new Request("http://localhost:5001/health/live"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("healthy");
  });

  test("/health/ready uses checkReady without touching storage and returns 200 or 503", async () => {
    let calls = 0;
    const okHandler = createHealthHandler({
      checkReady: async () => {
        calls++;
      },
    });
    const okRes = await okHandler(new Request("http://localhost:5001/health/ready"));
    expect(okRes.status).toBe(200);
    expect(calls).toBe(1);
    expect((await okRes.json()) as { checks: { postgres_ready: boolean } }).toMatchObject({
      status: "healthy",
      checks: { postgres_ready: true },
    });

    const failHandler = createHealthHandler({
      checkReady: async () => {
        throw new Error("db unreachable");
      },
    });
    const failRes = await failHandler(new Request("http://localhost:5001/health/ready"));
    expect(failRes.status).toBe(503);
    expect((await failRes.json()) as { checks: { postgres_ready: boolean } }).toMatchObject({
      status: "unhealthy",
      checks: { postgres_ready: false },
    });
  });

  test("/metrics returns 200 on success and 500 when collection throws", async () => {
    const okHandler = createHealthHandler({
      checkReady: async () => {},
      collectMetrics: async () => "# ok\n",
    });
    const okRes = await okHandler(new Request("http://localhost:5001/metrics"));
    expect(okRes.status).toBe(200);
    expect(await okRes.text()).toBe("# ok\n");

    const failHandler = createHealthHandler({
      checkReady: async () => {},
      collectMetrics: async () => {
        throw new Error("serializer failed");
      },
    });
    const failRes = await failHandler(new Request("http://localhost:5001/metrics"));
    expect(failRes.status).toBe(500);
  });
});
