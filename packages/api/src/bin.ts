#!/usr/bin/env node
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
const server = createRebacApiServer({ app });

server.listen(config.port, config.host, () => {
  process.stdout.write(`ReBAC API listening on http://${config.host}:${config.port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close((error) => {
      if (error) {
        process.stderr.write(`ReBAC API shutdown failed: ${error.message}\n`);
        process.exitCode = 1;
      }
    });
  });
}
