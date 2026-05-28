import { readFileSync } from "node:fs";
import type { DiscoveryRunWarning, JsonRecord } from "@access-kit/core";

export const AWS_READONLY_ACCESS_ANALYSIS_CONNECTOR_ID = "aws-readonly-access-analysis";
export const AWS_READONLY_ACCESS_ANALYSIS_REQUIRED_READ_SCOPES = [
  "organizations:DescribeOrganization",
  "organizations:ListAccounts",
  "sso:ListPermissionSets",
  "sso:DescribePermissionSet",
  "sso:ListAccountAssignments",
  "iam:ListRoles",
  "cloudtrail:LookupEvents",
  "access-analyzer:ListFindings"
] as const;
export const AWS_READONLY_ACCESS_ANALYSIS_FORBIDDEN_WRITE_SCOPES = [
  "organizations:Write",
  "sso:Write",
  "identitystore:Write",
  "iam:Write",
  "cloudtrail:Write",
  "access-analyzer:Write"
] as const;

export const DEFAULT_MAX_PAGES = 100;
export const DEFAULT_MAX_RETRIES = 2;

export type AwsReadOperation =
  | "organizations.describeOrganization"
  | "organizations.listAccounts"
  | "ssoAdmin.listPermissionSets"
  | "ssoAdmin.describePermissionSet"
  | "ssoAdmin.listAccountAssignments"
  | "iam.listRoles"
  | "cloudTrail.lookupEvents"
  | "accessAnalyzer.listFindings";

export interface AwsReadOperationDescriptor {
  readonly operation: AwsReadOperation;
  readonly service: "accessAnalyzer" | "cloudTrail" | "iam" | "organizations" | "ssoAdmin";
  readonly action: string;
  readonly scope: DiscoveryRunWarning["scope"];
  readonly paginated: boolean;
}

export const AWS_READ_OPERATION_DESCRIPTORS = {
  "organizations.describeOrganization": {
    operation: "organizations.describeOrganization",
    service: "organizations",
    action: "DescribeOrganization",
    scope: "resources",
    paginated: false
  },
  "organizations.listAccounts": {
    operation: "organizations.listAccounts",
    service: "organizations",
    action: "ListAccounts",
    scope: "resources",
    paginated: true
  },
  "ssoAdmin.listPermissionSets": {
    operation: "ssoAdmin.listPermissionSets",
    service: "ssoAdmin",
    action: "ListPermissionSets",
    scope: "resources",
    paginated: true
  },
  "ssoAdmin.describePermissionSet": {
    operation: "ssoAdmin.describePermissionSet",
    service: "ssoAdmin",
    action: "DescribePermissionSet",
    scope: "resources",
    paginated: false
  },
  "ssoAdmin.listAccountAssignments": {
    operation: "ssoAdmin.listAccountAssignments",
    service: "ssoAdmin",
    action: "ListAccountAssignments",
    scope: "native_grants",
    paginated: true
  },
  "iam.listRoles": {
    operation: "iam.listRoles",
    service: "iam",
    action: "ListRoles",
    scope: "resources",
    paginated: true
  },
  "cloudTrail.lookupEvents": {
    operation: "cloudTrail.lookupEvents",
    service: "cloudTrail",
    action: "LookupEvents",
    scope: "native_grants",
    paginated: true
  },
  "accessAnalyzer.listFindings": {
    operation: "accessAnalyzer.listFindings",
    service: "accessAnalyzer",
    action: "ListFindings",
    scope: "native_grants",
    paginated: true
  }
} as const satisfies Record<AwsReadOperation, AwsReadOperationDescriptor>;

export interface AwsReadCollectionPage<T> {
  value: T[];
  nextToken?: string;
  status?: number;
  retryAfterSeconds?: number;
  requestId?: string;
}

export interface AwsReadClient {
  list<T>(operation: AwsReadOperation, input?: JsonRecord): Promise<AwsReadCollectionPage<T>>;
}

export interface AwsCollectionRead<T> {
  values: T[];
  completed: boolean;
}

export type AwsReadClientPages = Record<string, Array<AwsReadCollectionPage<unknown>>>;

export class JsonAwsReadClient implements AwsReadClient {
  readonly calls: Array<{ operation: AwsReadOperation; input?: JsonRecord }> = [];
  readonly #pages: Map<string, Array<AwsReadCollectionPage<unknown>>>;

  constructor(pages: AwsReadClientPages | { pages: AwsReadClientPages }) {
    const source = "pages" in pages ? pages.pages : pages;
    this.#pages = new Map(Object.entries(source).map(([key, value]) => [key, [...value]]));
  }

  async list<T>(operation: AwsReadOperation, input: JsonRecord = {}): Promise<AwsReadCollectionPage<T>> {
    this.calls.push({ operation, input });
    const directKey = awsReadClientKey(operation, input);
    const pages = this.#pages.get(directKey) ?? this.#pages.get(operation);

    if (!pages || pages.length === 0) {
      throw new Error(`No AWS read fixture page for ${directKey}`);
    }

    return pages.shift() as AwsReadCollectionPage<T>;
  }
}

export function awsReadClientKey(operation: AwsReadOperation, input: JsonRecord = {}): string {
  const stableInput = stableJson(input);
  return stableInput === "{}" ? operation : `${operation}:${stableInput}`;
}

const MAX_RETRY_AFTER_MILLISECONDS = 60_000;

export function retryAfterSecondsToMilliseconds(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.ceil(value * 1000), MAX_RETRY_AFTER_MILLISECONDS)
    : 0;
}

export async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export function readJsonFixture(path: string): AwsReadClientPages {
  const body: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (isJsonRecord(body) && isJsonRecord(body.pages)) {
    return body.pages as AwsReadClientPages;
  }

  if (isJsonRecord(body)) {
    return body as AwsReadClientPages;
  }

  return {};
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (isJsonRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
