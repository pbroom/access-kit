export const CLI_EXIT_CODES = {
  success: 0,
  apiFailure: 70,
  configuration: 78
} as const;

export type CliExitCode = typeof CLI_EXIT_CODES[keyof typeof CLI_EXIT_CODES];

export class CliConfigurationError extends Error {}

export function formatCliError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function writeCliError(error: unknown): void {
  process.stderr.write(`error: ${formatCliError(error)}\n`);
  process.exitCode = error instanceof CliConfigurationError
    ? CLI_EXIT_CODES.configuration
    : CLI_EXIT_CODES.apiFailure;
}
