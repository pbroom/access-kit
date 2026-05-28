import { Command } from "commander";

import { addCommandGroups } from "./command-groups.js";
import { createCliContext, type CliOptions } from "./runtime-options.js";

export { CLI_COMMANDS } from "./command-registry.js";
export type { CliApiSurface, CliCommandSpec } from "./command-registry.js";
export { CLI_EXIT_CODES } from "./errors.js";
export type { CliExitCode } from "./errors.js";
export type { CliOptions, CliProfile, CliProfileConfig, CliRuntimeOptions } from "./runtime-options.js";

export function buildCli(options: CliOptions = {}): Command {
  const program = new Command();
  program
    .name("rebac")
    .description("Operator CLI for the Access Kit ReBAC control plane.")
    .version("0.1.0")
    .option("--api-url <url>", "ReBAC API base URL")
    .option("--api-key-env <name>", "Environment variable containing the bearer token")
    .option("--config <path>", "CLI profile config JSON")
    .option("--profile <name>", "CLI profile name")
    .option("--preview", "Print the request that would be sent without calling the API")
    .option("--diff", "Include request diff lines in preview output (requires --preview)");

  addCommandGroups(program, createCliContext(options));

  return program;
}
