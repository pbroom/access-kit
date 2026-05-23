# Non-Goals

## Purpose

This page protects the boundary of the Access Kit ReBAC authorization control plane. It should be used when evaluating feature requests, compliance statements, connector work, and operational assumptions.

## Audience

Product/governance leads, platform engineers, security engineers, ISSOs, assessors, and implementation teams.

## Non-Goals

Access Kit is not:

- an identity provider
- an authentication system
- a local password store
- a SIEM
- a ticketing system
- a generic workflow platform
- a replacement for Entra ID, Active Directory, AWS IAM, SharePoint permissions, Teams membership, Power Platform security roles, Dataverse roles, IAM Identity Center, or application-specific enforcement
- a UI-first admin portal
- an LLM-based access decision engine
- an authorization to operate

No LLM may make authorization decisions, approve access, create grants, revoke grants, or replace deterministic policy evaluation.

## Boundary Implications

Authentication remains with approved identity providers such as Entra ID, AD federation, PIV/CAC-backed flows, IAM Identity Center, or agency-approved IdPs. Native platforms continue enforcing access locally where applicable.

Access Kit owns the authorization control-plane record: relationship facts, deterministic decisions, explanations, intended grants, provisioning plans, connector actions, drift findings, audit events, and evidence exports.

## Examples

| Request | In scope? | Reason |
| --- | --- | --- |
| Explain why `user:alice` can read `document:case-plan`. | Yes | This is deterministic authorization evidence. |
| Authenticate `user:alice` with a password. | No | Authentication belongs to an approved IdP. |
| Export bounded audit events for a SIEM forwarder. | Yes | SIEM-ready export metadata is in scope. |
| Replace the SIEM with Access Kit dashboards. | No | Access Kit is not a SIEM. |
| Compare intended grants to observed native grants. | Yes | Drift is a first-class security finding. |
| Claim FedRAMP authorization. | No | The repository supports ATO-oriented evidence only. |

## Security Considerations

Non-goals are security controls. Treating native provider access as intended access, allowing live writes before connector review, or letting LLM output drive decisions would break the trust model.

## Audit And Evidence Implications

Audit events and evidence exports should record what Access Kit actually controls and what remains an external dependency. Evidence packages must distinguish implemented local proof points from planned production controls.

## Related References

- [System Context and Boundary](system-context-and-boundary.md)
- [Security Model](security-model.md)
- [Threat Model](threat-model.md)
- [ADR 0001: API-first and CLI-first](../adrs/0001-api-first-cli-first.md)
- [ADR 0002: Deterministic authorization](../adrs/0002-deterministic-authorization.md)
- [ADR 0010: Fail behavior](../adrs/0010-fail-behavior.md)
