import type { ServerResponse } from "node:http";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export function notFound(response: ServerResponse): void {
  sendJson(response, 404, {
    code: "NOT_FOUND",
    message: "Route or object was not found",
    correlationId: "corr:not-found"
  });
}
