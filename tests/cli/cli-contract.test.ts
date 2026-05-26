import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Command } from "commander";
import YAML from "yaml";
import { API_ROUTE_SURFACES } from "../../packages/api/src/index.js";
import { buildCli, CLI_COMMANDS } from "../../packages/cli/src/index.js";

describe("CLI contract", () => {
  it("maps every documented command to an API surface", () => {
    expect(CLI_COMMANDS.length).toBeGreaterThanOrEqual(20);

    for (const command of CLI_COMMANDS) {
      expect(command.path).toMatch(/^[a-z]+( [a-z-]+)*$/);
      expect(command.apiSurface).toMatch(/^(?:(GET|POST|PUT|DELETE) \/v1\/|local$)/);
      expect(command.description.length).toBeGreaterThan(10);
    }
  });

  it("includes first-class operator, CI/CD, and assessor commands", () => {
    const paths = new Set(CLI_COMMANDS.map((command) => command.path));

    expect(paths).toContain("ready");
    expect(paths).toContain("check");
    expect(paths).toContain("explain");
    expect(paths).toContain("resource native-access");
    expect(paths).toContain("policy validate");
    expect(paths).toContain("policy publish");
    expect(paths).toContain("provision plan");
    expect(paths).toContain("provision apply");
    expect(paths).toContain("emergency revoke");
    expect(paths).toContain("reconcile run");
    expect(paths).toContain("discovery runs");
    expect(paths).toContain("audit search");
    expect(paths).toContain("audit integrity");
    expect(paths).toContain("audit export");
    expect(paths).toContain("evidence export");
    expect(paths).toContain("evidence verify");
    expect(paths).toContain("connector readiness");
    expect(paths).toContain("connector sync");
    expect(paths).toContain("completion");
  });

  it("exposes expected top-level command families", () => {
    const program = buildCli();
    const help = program.helpInformation();

    expect(help).toContain("subject");
    expect(help).toContain("resource");
    expect(help).toContain("relation");
    expect(help).toContain("policy");
    expect(help).toContain("emergency");
    expect(help).toContain("provision");
    expect(help).toContain("reconcile");
    expect(help).toContain("discovery");
    expect(help).toContain("audit");
    expect(help).toContain("evidence");
    expect(help).toContain("connector");
    expect(help).toContain("completion");
  });

  it("keeps the command manifest aligned with registered Commander leaves", () => {
    expect(new Set(commandLeafPaths(buildCli()))).toEqual(new Set(CLI_COMMANDS.map((command) => command.path)));
  });

  it("keeps OpenAPI, runtime routes, and CLI command surfaces in parity", async () => {
    const openApi = YAML.parse(
      await readFile(join(process.cwd(), "openapi/rebac-control-plane.yaml"), "utf8")
    ) as { paths: Record<string, Record<string, unknown>> };
    const openApiSurfaces = new Set(
      Object.entries(openApi.paths).flatMap(([path, operations]) =>
        Object.keys(operations)
          .filter((method) => ["delete", "get", "post", "put"].includes(method))
          .map((method) => `${method.toUpperCase()} ${path}`)
      )
    );
    const runtimeSurfaces = new Set(API_ROUTE_SURFACES.map((surface) => `${surface.method} ${surface.path}`));

    expect(API_ROUTE_SURFACES.length).toBe(new Set(API_ROUTE_SURFACES.map((surface) => `${surface.method} ${surface.path}`)).size);

    for (const surface of runtimeSurfaces) {
      expect(openApiSurfaces, `${surface} must be documented in OpenAPI`).toContain(surface);
    }

    for (const surface of openApiSurfaces) {
      expect(runtimeSurfaces, `${surface} must be implemented by the runtime route registry`).toContain(surface);
    }

    for (const command of CLI_COMMANDS.filter((item) => item.apiSurface !== "local")) {
      expect(openApiSurfaces, `${command.path} must target an OpenAPI operation`).toContain(command.apiSurface);
      expect(runtimeSurfaces, `${command.path} must target an implemented runtime route`).toContain(command.apiSurface);
    }
  });
});

function commandLeafPaths(command: Command, parentPath: string[] = []): string[] {
  return command.commands.flatMap((child) => {
    const childPath = [...parentPath, child.name()];

    if (child.commands.length === 0) {
      return [childPath.join(" ")];
    }

    return commandLeafPaths(child, childPath);
  });
}
