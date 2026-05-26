import { describe, expect, it } from "vitest";
import { createRebacLocalApp } from "../../packages/api/src/local-app.js";
import type { ConnectorAdapter } from "../../packages/core/src/index.js";
import { validateConnectorSecurityGate } from "../../scripts/validate-connector-security-gate.js";

describe("connector security gate validation", () => {
  it("validates every runtime connector security review", async () => {
    const app = createRebacLocalApp({ now: () => "2026-05-26T00:00:00.000Z" });
    const results = await validateConnectorSecurityGate(app);

    expect(results).toHaveLength(4);
    expect(results.map((result) => result.connectorId).sort()).toEqual([
      "aws-readonly",
      "entra-readonly",
      "mock",
      "sharepoint-readonly"
    ]);
  });

  it("rejects connectors without security review evidence", async () => {
    const app = createRebacLocalApp({ now: () => "2026-05-26T00:00:00.000Z" });
    const connector = app.connectors.get("entra-readonly") as ConnectorAdapter & {
      getSecurityReview?: ConnectorAdapter["getSecurityReview"];
    };
    connector.getSecurityReview = undefined;

    await expect(validateConnectorSecurityGate(app)).rejects.toThrow("getSecurityReview");
  });

  it("rejects provider-style connectors that advertise provisioning before live review", async () => {
    const app = createRebacLocalApp({ now: () => "2026-05-26T00:00:00.000Z" });
    const connector = app.connectors.get("aws-readonly")!;
    connector.capabilities = {
      ...connector.capabilities,
      supportsProvisioning: true
    };

    await expect(validateConnectorSecurityGate(app)).rejects.toThrow("must not advertise provisioning");
  });

  it.each(["mark_deleted", "ignore"] as const)("rejects %s deletion behavior without cursor metadata", async (deletion) => {
    const app = createRebacLocalApp({ now: () => "2026-05-26T00:00:00.000Z" });
    const connector = app.connectors.get("entra-readonly")!;
    const review = connector.getSecurityReview?.();
    const metadata = connector.getDiscoveryMetadata?.();

    expect(review).toBeDefined();
    expect(metadata).toBeDefined();

    connector.getSecurityReview = () => ({
      ...review!,
      operations: {
        ...review!.operations,
        deletion
      }
    });
    connector.getDiscoveryMetadata = () => {
      const metadataWithoutCursor = { ...metadata! };
      delete metadataWithoutCursor.cursor;
      return metadataWithoutCursor;
    };

    await expect(validateConnectorSecurityGate(app)).rejects.toThrow(`deletion behavior ${deletion} requires metadata.cursor`);
  });
});
