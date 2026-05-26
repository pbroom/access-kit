import { describe, expect, it } from "vitest";
import { createRebacLocalApp } from "../../packages/api/src/local-app.js";
import type { ConnectorAdapter } from "../../packages/core/src/index.js";
import { validateConnectorSecurityGate } from "../../scripts/validate-connector-security-gate.js";

describe("connector security gate validation", () => {
  it("validates every runtime connector security review", async () => {
    const app = createRebacLocalApp({ now: () => "2026-05-26T00:00:00.000Z" });

    await expect(validateConnectorSecurityGate(app)).resolves.toEqual([
      expect.objectContaining({ connectorId: "mock" }),
      expect.objectContaining({ connectorId: "entra-readonly" }),
      expect.objectContaining({ connectorId: "sharepoint-readonly" }),
      expect.objectContaining({ connectorId: "aws-readonly" })
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
});
