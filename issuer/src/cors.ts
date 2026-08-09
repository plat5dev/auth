export function createCorsHeaders(allowedOrigins: string[]) {
  return function getCorsHeaders(request: Request): Record<string, string> {
    const origin = request.headers.get("origin");
    if (origin && allowedOrigins.includes(origin)) {
      return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      };
    }
    return {};
  };
}
