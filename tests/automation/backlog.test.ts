import { describe, expect, it } from "vitest";

import { parseBacklog, selectReadyBacklogBatch } from "../../scripts/lib/automation.js";

const backlogMarkdown = `
# Backlog

| ID | Slice | Status | Priority | Depends On | Parallel | Area | Branch | PR | Acceptance Checks | Security Notes | Next Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AK-001 | Foundation | merged | P0 | - | no | foundation | codex/foundation | #1 | Foundation validates. | Synthetic only. | Keep stable. |
| AK-002 | Storage runtime | ready | P0 | AK-001 | no | storage-runtime | codex/storage-runtime | - | Storage validates. | No secrets. | Start first. |
| AK-003 | Connector persistence | ready | P1 | AK-002 | yes | connector-state | codex/connector-persistence | - | Connectors persist. | Read-only default. | Start after storage. |
| AK-004 | Evidence integrity | ready | P1 | AK-002 | yes | evidence-integrity | codex/evidence-integrity | - | Evidence hashes verify. | No secrets. | Start after storage. |
| AK-005 | Audit export polish | ready | P2 | AK-001 | yes | evidence-integrity | codex/audit-export-polish | - | Export validates. | No secrets. | Can follow evidence. |
`;

describe("implementation backlog parsing and batching", () => {
  it("selects a serial foundation slice by itself", () => {
    const items = parseBacklog(backlogMarkdown);

    expect(selectReadyBacklogBatch(items).map((item) => item.id)).toEqual(["AK-002"]);
  });

  it("selects parallel-safe dependency-cleared work across different areas", () => {
    const items = parseBacklog(backlogMarkdown.replace("AK-002 | Storage runtime | ready", "AK-002 | Storage runtime | merged"));

    expect(selectReadyBacklogBatch(items).map((item) => item.id)).toEqual(["AK-003", "AK-004"]);
  });

  it("respects the batch size limit", () => {
    const items = parseBacklog(backlogMarkdown.replace("AK-002 | Storage runtime | ready", "AK-002 | Storage runtime | merged"));

    expect(selectReadyBacklogBatch(items, { maxItems: 1 }).map((item) => item.id)).toEqual(["AK-003"]);
  });
});
