import { readFileSync } from "node:fs";
import type { Command } from "commander";

import { CliConfigurationError, formatCliError } from "./errors.js";

export interface CliProfile {
  apiUrl?: string;
  apiKeyEnv?: string;
}

export interface CliProfileConfig {
  profiles?: Record<string, CliProfile>;
}

export interface CliRuntimeOptions {
  apiUrl: string;
  apiKey?: string;
  preview: boolean;
  diff: boolean;
}

export interface CliOptions {
  apiUrl?: string;
  apiKeyEnv?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  profiles?: Record<string, CliProfile>;
  writeText?: (value: string) => void;
  writeJson?: (value: unknown) => void;
  now?: () => string;
}

export interface CliContext {
  fetch: typeof fetch;
  defaultApiUrl?: string;
  defaultApiKeyEnv?: string;
  configPath?: string;
  env: NodeJS.ProcessEnv;
  profiles: Record<string, CliProfile>;
  writeText: (value: string) => void;
  writeJson: (value: unknown) => void;
  now: () => string;
}

interface RootCliOptions {
  apiUrl?: string;
  apiKeyEnv?: string;
  config?: string;
  profile?: string;
  preview?: boolean;
  diff?: boolean;
}

export function createCliContext(options: CliOptions): CliContext {
  return {
    defaultApiUrl: options.apiUrl,
    defaultApiKeyEnv: options.apiKeyEnv,
    configPath: options.configPath,
    env: options.env ?? process.env,
    fetch: options.fetch ?? fetch,
    profiles: options.profiles ?? {},
    writeText:
      options.writeText ??
      ((value: string) => {
        console.log(value);
      }),
    writeJson:
      options.writeJson ??
      ((value: unknown) => {
        console.log(JSON.stringify(value, null, 2));
      }),
    now: options.now ?? (() => new Date().toISOString())
  };
}

export function resolveRuntimeOptions(command: Command, context: CliContext): CliRuntimeOptions {
  const root = getRootCommand(command);
  const rootOptions = root.opts<RootCliOptions>();
  const preview = rootOptions.preview === true;
  const diff = rootOptions.diff === true;

  if (diff && !preview) {
    throw new CliConfigurationError("--diff requires --preview.");
  }

  const profileConfig = readProfileConfig(rootOptions, context);
  const profileName = rootOptions.profile ?? context.env.REBAC_PROFILE;
  const profile = readProfile(profileConfig, profileName);
  const apiKeyEnv = rootOptions.apiKeyEnv
    ?? profile?.apiKeyEnv
    ?? context.defaultApiKeyEnv
    ?? context.env.REBAC_API_KEY_ENV
    ?? "REBAC_API_KEY";

  return {
    apiUrl: rootOptions.apiUrl
      ?? profile?.apiUrl
      ?? context.defaultApiUrl
      ?? context.env.REBAC_API_URL
      ?? "http://127.0.0.1:3000",
    apiKey: context.env[apiKeyEnv],
    preview,
    diff
  };
}

function readProfileConfig(rootOptions: RootCliOptions, context: CliContext): CliProfileConfig {
  const configPath = rootOptions.config ?? context.configPath ?? context.env.REBAC_CLI_CONFIG;
  const profiles = { ...context.profiles };

  if (!configPath) {
    return { profiles };
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    const config = parseProfileConfig(parsed, configPath);
    return {
      profiles: {
        ...profiles,
        ...config.profiles
      }
    };
  } catch (error) {
    if (error instanceof CliConfigurationError) {
      throw error;
    }

    throw new CliConfigurationError(`Unable to read CLI config ${configPath}: ${formatCliError(error)}`);
  }
}

function parseProfileConfig(value: unknown, path: string): CliProfileConfig {
  if (!isRecord(value)) {
    throw new CliConfigurationError(`CLI config ${path} must be a JSON object.`);
  }

  if (value.profiles === undefined) {
    return { profiles: {} };
  }

  if (!isRecord(value.profiles)) {
    throw new CliConfigurationError(`CLI config ${path} profiles must be an object.`);
  }

  const profiles: Record<string, CliProfile> = {};
  for (const [name, profile] of Object.entries(value.profiles)) {
    if (!isRecord(profile)) {
      throw new CliConfigurationError(`CLI profile ${name} must be an object.`);
    }

    profiles[name] = {
      apiUrl: readOptionalString(profile.apiUrl, `${name}.apiUrl`),
      apiKeyEnv: readOptionalString(profile.apiKeyEnv, `${name}.apiKeyEnv`)
    };
  }

  return { profiles };
}

function readProfile(config: CliProfileConfig, profileName: string | undefined): CliProfile | undefined {
  if (!profileName) {
    return undefined;
  }

  const profile = config.profiles?.[profileName];
  if (!profile) {
    throw new CliConfigurationError(`CLI profile ${profileName} was not found.`);
  }

  return profile;
}

function getRootCommand(command: Command): Command {
  let root = command;
  while (root.parent) {
    root = root.parent;
  }

  return root;
}

function readOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.length === 0) {
    throw new CliConfigurationError(`CLI profile field ${label} must be a non-empty string.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
