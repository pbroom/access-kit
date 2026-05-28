import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createDemoSeedData } from "../../packages/core/src/index.js";
import { createRebacApiServer, createRebacLocalApp } from "../../packages/api/src/index.js";

const host = process.env.REBAC_API_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.REBAC_API_PORT ?? "8080", 10);
const apiKeys = readApiKeys();

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error("REBAC_API_PORT must be a valid TCP port.");
}

const app = createRebacLocalApp({
  seed: createDemoSeedData(),
  now: () => "2026-05-21T17:00:00.000Z"
});
const server = createRebacApiServer({ app, apiKeys });

server.listen(port, host);
await once(server, "listening");

const address = server.address() as AddressInfo;
console.log(`Access Kit demo seed API listening on http://${address.address}:${address.port}`);
console.log("Bearer auth is enabled from REBAC_API_KEYS; token material was not printed.");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
  });
}

function readApiKeys(): string[] {
  const keys = (process.env.REBAC_API_KEYS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (keys.length === 0) {
    throw new Error("Set REBAC_API_KEYS to a local throwaway bearer token before starting the demo seed API.");
  }

  return keys;
}
