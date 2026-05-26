# Threat Model

## Purpose

This page identifies primary assets, trust boundaries, attacker capabilities, abuse paths, mitigations, residual risks, and evidence for the Access Kit authorization control plane.

## Audience

Security engineers, platform engineers, ISSOs, assessors, connector developers, and incident responders.

## What This Is

This is a repository-grounded threat model for the current local proof point and planned production direction.

## What This Is Not

This is not a penetration test report, live deployment threat model, or final risk acceptance. Production deployments must update it with actual hosts, identity providers, connectors, data stores, network boundaries, and monitoring.

## Assets

- canonical subject and resource records
- relationship tuples and policy versions
- decision and explanation responses
- intended grants and provisioning plans
- native grant readback
- connector credentials and scopes, when live connectors exist
- drift findings
- audit events, hashes, and exports
- evidence packages and control mappings

## Attacker Capabilities

- Submit forged or excessive decision/provisioning requests.
- Attempt to bypass deny-by-default through malformed relationships.
- Abuse stale or overprivileged connector credentials.
- Hide unauthorized native grants by disrupting readback.
- Tamper with audit events or evidence packages.
- Exfiltrate sensitive relationship, subject, or resource metadata through explanations.
- Confuse proof-point evidence with production authorization status.

## Abuse Paths And Mitigations

| Abuse path | Mitigation in current foundation | Remaining production work |
| --- | --- | --- |
| Decision bypass | Deterministic engine, deny by default, explicit deny precedence, policy proof points. | Deployed API authentication, rate limits, authorization for admin APIs. |
| Relationship poisoning | Versioned relationship tuples, audit events, idempotent writes. | Approval workflow, durable storage, source integrity checks. |
| Overprivileged connector | Read-only synthetic connectors, connector security review gate, readiness gates, secrets out of scope. | Managed identity/vault, rotation, live-provider consent evidence, monitoring. |
| Silent drift | Drift findings and reconciliation endpoints. | Durable reconciliation schedule and alerting. |
| Audit tampering | Payload hashes and hash-chain integrity report. | WORM or tamper-evident storage and retention. |
| Evidence overclaiming | Docs mark proof-point versus production gaps. | Assessor-reviewed statements and deployment-specific evidence. |

## Concrete Example

If an attacker adds a native provider grant outside Access Kit, discovery records the native grant, reconciliation creates a drift finding, audit captures the finding, and the drift remediation runbook guides revoke or exception handling.

## Security Considerations

- Decision and explanation APIs are sensitive because they reveal authorization structure.
- Connector identities must be scoped to the smallest provider boundary that supports required readback or enforcement.
- Connector changes must pass `pnpm validate:connector-security` so consent, scopes, tenant boundaries, secret handling, and no-write defaults are reviewed before live provider access.
- Emergency revocation must stay available even when normal grant workflows are paused.
- Evidence export access should be restricted because evidence can include sensitive system structure.

## Audit And Evidence Implications

Threat mitigations should be evidenced by tests, ADRs, audit events, runbooks, validation reports, drift findings, and control mappings. Residual risks should be carried into POA&M inputs where appropriate.

## Related Controls

AC, AU, CA, CM, IA, IR, RA, SC, SI, SA, SR, and PT controls intersect with this threat model.

## Related References

- [Security Model](security-model.md)
- [System Context and Boundary](system-context-and-boundary.md)
- [Control Traceability Matrix](control-traceability-matrix.md)
- [Connector Contract](connector-contract.md)
- [Drift Detection Model](drift-detection-model.md)
- [ADR 0009: Secret management](../adrs/0009-secret-management.md)
- [ADR 0010: Fail behavior](../adrs/0010-fail-behavior.md)
