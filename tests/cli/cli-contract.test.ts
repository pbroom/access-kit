import { describe, expect, it } from "vitest";
import { buildCli, CLI_COMMANDS } from "../../packages/cli/src/index.js";

describe("CLI contract", () => {
  it("maps every documented command to an API surface", () => {
    expect(CLI_COMMANDS.length).toBeGreaterThanOrEqual(20);

    for (const command of CLI_COMMANDS) {
      expect(command.path).toMatch(/^[a-z]+( [a-z-]+)*$/);
      expect(command.apiSurface).toMatch(/^(GET|POST|PUT|DELETE) \/v1\//);
      expect(command.description.length).toBeGreaterThan(10);
    }
  });

  it("includes first-class operator, CI/CD, and assessor commands", () => {
    const paths = new Set(CLI_COMMANDS.map((command) => command.path));

    expect(paths).toContain("check");
    expect(paths).toContain("explain");
    expect(paths).toContain("resource native-access");
    expect(paths).toContain("policy validate");
    expect(paths).toContain("policy publish");
    expect(paths).toContain("provision plan");
    expect(paths).toContain("reconcile run");
    expect(paths).toContain("audit search");
    expect(paths).toContain("evidence export");
    expect(paths).toContain("connector sync");
  });

  it("exposes expected top-level command families", () => {
    const program = buildCli();
    const help = program.helpInformation();

    expect(help).toContain("subject");
    expect(help).toContain("resource");
    expect(help).toContain("relation");
    expect(help).toContain("policy");
    expect(help).toContain("provision");
    expect(help).toContain("reconcile");
    expect(help).toContain("audit");
    expect(help).toContain("evidence");
    expect(help).toContain("connector");
  });
});
