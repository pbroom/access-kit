import { describe, expect, it } from "vitest";
import {
  authenticateRequest,
  normalizeApiKeys,
  parseApiKeyEntry,
  parseApiKeys,
  resolveRequestAuditActor
} from "../../packages/api/src/api-auth.js";

describe("api auth", () => {
  it("parses labeled and unlabeled API key entries", () => {
    expect(parseApiKeyEntry("alpha")).toEqual({ raw: "alpha", token: "alpha" });
    expect(parseApiKeyEntry("ci-bot:secret-token")).toEqual({
      raw: "ci-bot:secret-token",
      label: "ci-bot",
      token: "secret-token"
    });
    expect(parseApiKeyEntry(":token-only")).toEqual({ raw: ":token-only", token: ":token-only" });
  });

  it("deduplicates configured keys by token material", () => {
    expect(parseApiKeys(["alpha", " beta ", "alpha", "dup:alpha"])).toEqual([
      { raw: "alpha", token: "alpha" },
      { raw: "beta", token: "beta" }
    ]);
  });

  it("preserves normalizeApiKeys raw-string deduplication", () => {
    expect(normalizeApiKeys([" prefix:token ", "other:token", "prefix:token"])).toEqual([
      "prefix:token",
      "other:token"
    ]);
  });

  it("authenticates bearer tokens against configured token material", () => {
    const apiKeys = parseApiKeys(["ci-bot:secret-token", "legacy-token"]);
    const authenticated = authenticateRequest({
      headers: { authorization: "Bearer secret-token" }
    } as import("node:http").IncomingMessage, apiKeys);
    const invalid = authenticateRequest({
      headers: { authorization: "Bearer wrong-token" }
    } as import("node:http").IncomingMessage, apiKeys);

    expect(authenticated).toEqual({ status: "authenticated", apiKeyLabel: "ci-bot" });
    expect(invalid).toEqual({ status: "invalid" });
  });

  it("keeps the first matching label when callers provide duplicate token material", () => {
    const authenticated = authenticateRequest({
      headers: { authorization: "Bearer shared-token" }
    } as import("node:http").IncomingMessage, [
      { raw: "first:shared-token", label: "first", token: "shared-token" },
      { raw: "second:shared-token", label: "second", token: "shared-token" }
    ]);

    expect(authenticated).toEqual({ status: "authenticated", apiKeyLabel: "first" });
  });

  it("resolves labeled audit actors and falls back to the configured actor", () => {
    expect(resolveRequestAuditActor("service:api", "ci-bot")).toBe("api-key:ci-bot");
    expect(resolveRequestAuditActor("service:api")).toBe("service:api");
  });
});
