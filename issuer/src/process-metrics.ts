import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("issuer.process");

const startTime = Date.now() / 1000;

meter.createObservableGauge("process_resident_memory_bytes", {
  description: "Resident memory size in bytes",
  unit: "By",
}).addCallback((result) => {
  result.observe(process.memoryUsage.rss());
});

meter.createObservableGauge("process_heap_bytes", {
  description: "Process heap size in bytes",
  unit: "By",
}).addCallback((result) => {
  const mem = process.memoryUsage();
  result.observe(mem.heapUsed);
});

meter.createObservableGauge("process_virtual_memory_bytes", {
  description: "Virtual memory size in bytes",
  unit: "By",
}).addCallback((result) => {
  const mem = process.memoryUsage();
  result.observe(mem.heapTotal + mem.external + mem.arrayBuffers);
});

meter.createObservableCounter("process_cpu_seconds_total", {
  description: "Total user and system CPU time spent in seconds",
  unit: "s",
}).addCallback((result) => {
  const currentUsage = process.cpuUsage();
  const totalMicroseconds = currentUsage.user + currentUsage.system;
  result.observe(totalMicroseconds / 1_000_000);
});

meter.createObservableGauge("process_start_time_seconds", {
  description: "Start time of the process since unix epoch in seconds",
  unit: "s",
}).addCallback((result) => {
  result.observe(startTime);
});

meter.createObservableGauge("process_open_fds", {
  description: "Number of open file descriptors",
}).addCallback((result) => {
  try {
    const openedFiles = (Bun as unknown as { openedFiles?: number }).openedFiles;
    if (typeof openedFiles === "number") {
      result.observe(openedFiles);
    }
  } catch {
    // Ignore if not available
  }
});
