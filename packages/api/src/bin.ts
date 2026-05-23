#!/usr/bin/env node
import type { Socket } from "node:net";
import { createRebacApiServer } from "./server.js";
import { createRebacLocalApp } from "./local-app.js";
import { readRebacApiRuntimeConfig } from "./runtime-config.js";
import { LocalFileEvidenceRepository, LocalJsonFileStateRepository } from "@access-kit/core";

const config = readRebacApiRuntimeConfig();
const evidenceRepository = config.evidenceRoot ? new LocalFileEvidenceRepository({ rootDir: config.evidenceRoot }) : undefined;
const stateRepository = config.statePath ? new LocalJsonFileStateRepository({ statePath: config.statePath }) : undefined;
const app = createRebacLocalApp({
  actor: config.actor,
  auditRepository: evidenceRepository,
  evidenceRepository,
  stateRepository
});
const server = createRebacApiServer({ app, apiKeys: config.apiKeys });
const sockets = new Set<Socket>();
let shuttingDown = false;

server.on("connection", (socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});

server.listen(config.port, config.host, () => {
  process.stdout.write(`ReBAC API listening on http://${config.host}:${config.port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    server.close((error) => {
      if (error) {
        process.stderr.write(`ReBAC API shutdown failed: ${error.message}\n`);
        process.exitCode = 1;
      }

      process.exit(process.exitCode ?? 0);
    });
    server.closeIdleConnections();
    setTimeout(() => {
      sockets.forEach((socket) => socket.destroy());
    }, 5000).unref();
  });
}
