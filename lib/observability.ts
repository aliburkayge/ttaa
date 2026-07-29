type LogFields = Record<string, unknown>;

function safeFields(fields: LogFields) {
  const forbidden = /key|secret|password|authorization|document|brief|content|output/i;
  return Object.fromEntries(Object.entries(fields).filter(([key]) => !forbidden.test(key)));
}

export function logEvent(event: string, fields: LogFields = {}) {
  process.stdout.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    service: process.env.RAILWAY_SERVICE_NAME || "ttaa-content-studio",
    ...safeFields(fields),
  })}\n`);
}

export function newRequestId(request?: Request) {
  return request?.headers.get("x-railway-request-id")
    || request?.headers.get("x-request-id")
    || crypto.randomUUID();
}

