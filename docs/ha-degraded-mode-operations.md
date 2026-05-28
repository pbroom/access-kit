# HA And Degraded-Mode Operations

## Purpose

This page defines the production high-availability and degraded-mode operating contract for Access Kit. It extends the production reference architecture with explicit topology expectations, fail-closed behavior, queue backpressure handling, audit-forwarder outage behavior, read-only fallback rules, health signals, and recovery criteria.

## Audience

Platform engineers, security engineers, connector owners, incident responders, ISSOs, assessors, and operators responsible for production authorization infrastructure.

## What This Is

This is a release-readiness and operations contract. It tells a deployment team what must stay available, what can degrade, which actions must stop, and what evidence must be retained before Access Kit can claim resilient production operations.

## What This Is Not

This is not a selected cloud architecture, an autoscaling policy, a disaster-recovery approval, or permission to enable live provider writes. Target environments must still supply deployment-specific capacity, region, backup, SIEM, alerting, and recovery evidence.

## HA Topology

| Plane | HA expectation | Degraded-mode contract |
| --- | --- | --- |
| API service | Run at least two `rebac-api` replicas behind an approved IdP or mTLS gateway for production traffic. | If quorum, gateway identity, or readiness fails, protected authorization and admin mutation paths fail closed. |
| Graph and connector-state stores | Use durable external stores with tenant-boundary checks, backups, and restore evidence. | If graph reads are stale or unavailable, decisions for protected resources deny and connector-derived facts are treated as untrusted. |
| Job queue and workers | Use a durable queue with idempotency, lease expiry, retry, dead-letter, replay, connector health, and emergency revocation priority. | Queue backpressure pauses new grants and non-urgent discovery while emergency revocation remains reservable. |
| Audit and evidence store | Use append-only or immutable storage with signed windows, retention metadata, and backup evidence. | Mutating workflows that cannot retain required audit evidence stop before provider action. |
| SIEM forwarder | Deliver bounded audit windows and retain replay proof. | Decision and queue safety do not depend on SIEM delivery, but failed delivery becomes a high-severity integrity finding until replay succeeds. |
| Connectors | Keep live provider access read-only until connector-specific enforcement readiness is approved. | Missing readback, stale cursors, partial sync, or provider outage blocks live enforcement and raises operator-visible warnings. |
| Admin access | Require approved IdP or mTLS gateway, admin ReBAC, MFA, session bounds, revocation SLA, and break-glass evidence. | Admin mutation freezes unless emergency access is approved, time-boxed, audited, and reviewed. |

## Degraded Modes

| Mode | Trigger | Allowed behavior | Blocked behavior | Evidence |
| --- | --- | --- | --- | --- |
| API degraded | `/v1/health` fails, latency exceeds SLO, or readiness reports blocked production controls. | Public probes and incident diagnostics. | Protected decisions for sensitive resources, relationship writes, provisioning applies, and admin mutations. | Health output, readiness output, incident timeline, post-recovery sample decisions. |
| Graph stale or unavailable | Graph backend health fails, tenant-boundary verification fails, or restore point is older than accepted RPO. | Read-only diagnostics and restore validation. | Protected authorization decisions that depend on current graph facts. | Backend health, restore run, decision replay, tenant-boundary check. |
| Queue backpressure | Queue depth, oldest job age, failed reservation rate, or dead-letter count exceeds the environment threshold. | Emergency revocation, replay diagnostics, connector health updates, and idempotent recovery work. | New grants, non-urgent discovery, bulk reconciliation, and enforcement expansion. | Queue metrics, dead-letter list, replay result, emergency priority observation. |
| Audit store degraded | Append-only write, signed-window generation, evidence receipt, or backup metadata fails. | Read-only investigation and recovery actions that do not mutate authorization state. | Provider writes, relationship writes, admin policy changes, and evidence exports that would be incomplete. | Audit adapter findings, failed write receipt, signed-window recovery, backup status. |
| SIEM forwarding outage | Delivery failure, replay failure, or stale SIEM checkpoint. | Local immutable audit retention and bounded replay preparation. | Claiming ConMon delivery is healthy. | Delivery failure finding, retained window, replay receipt, alert routing note. |
| Connector readback degraded | Connector health is degraded/offline, cursor is stale, coverage warning is blocking, or partial sync recovery is incomplete. | Read-only diagnostics, provider status checks, and reconciliation planning. | Live enforcement, provider mutation, and closing high-risk drift as resolved. | Connector health, warning list, cursor age, provider status, reconciliation result. |
| Admin boundary degraded | IdP, mTLS gateway, admin ReBAC role binding, revocation evidence, or break-glass workflow is missing. | Health checks and emergency access review. | Admin mutation, policy publication, connector configuration changes, and enforcement enablement. | Admin readiness output, approval evidence, session expiry, post-action review. |

## Queue Backpressure

Production queues must publish at least these signals:

- queued job count by kind and connector
- oldest queued job age
- running job count and expired leases
- retry rate and next retry time
- dead-lettered job count by reason
- emergency revocation queue age
- connector health state
- idempotency key reuse failures

When backpressure is active, emergency revocation and security recovery jobs keep priority over discovery, evidence generation, new grants, and routine reconciliation. Workers may drain normal queues only after emergency revocation age returns inside the target SLO and dead-letter replay has an owner.

## Audit-Forwarder Outages

SIEM delivery failures must not erase local audit evidence. The audit/evidence store must retain the signed window, failed delivery metadata, replay cursor, and alert evidence. Operators may keep deterministic decisions running only while append-only audit writes remain healthy. Any provider mutation, admin mutation, or evidence export that cannot retain required audit evidence must stop before action.

## Read-Only Fallback

Read-only fallback allows operators to inspect health, readiness, audit windows, connector status, queue state, and evidence receipts. It does not authorize local fallback decisions, provider writes, relationship edits, or silent drift closure. Cached low-risk application reads are allowed only when the policy explicitly permits cache use and the request is outside protected resources.

## Health Signals

Production dashboards and readiness evidence should include:

- `/v1/health` and `/v1/ready` results
- admin authorization readiness
- graph, connector-state, queue, audit, evidence, and SIEM adapter status
- queue depth, oldest job age, dead-letter count, and emergency revocation age
- connector health, cursor age, coverage warnings, and partial sync recovery state
- audit signed-window freshness, SIEM delivery status, and replay status
- backup/restore recency for graph, queue, audit, evidence, and configuration
- failed authentication and admin mutation counts
- drift finding severity and stale-readback warnings

## Recovery Criteria

A degraded mode can close only after:

1. the triggering health signal is healthy for two consecutive observation windows;
2. emergency revocation jobs are drained or explicitly owned by incident response;
3. dead-lettered queue jobs have replay, compensation, or accepted-risk evidence;
4. audit append, signed-window, and SIEM replay evidence is retained for the incident window;
5. connector cursors and coverage warnings are current enough for the affected provider boundary;
6. sample decisions replay with the expected policy, relationship, and decision versions;
7. admin sessions used during the incident have expired or been revoked;
8. a post-action review records residual risk, follow-up owners, and any exception expiry.

## Evidence To Retain

- health and readiness output before, during, and after degradation
- queue depth, retry, dead-letter, replay, and emergency revocation priority observations
- audit adapter findings, signed-window verification, SIEM delivery failure, and replay receipt
- connector health, cursor, coverage-warning, and reconciliation output
- backup/restore evidence for any recovered component
- change, incident, or exception reference
- admin authorization, break-glass, notification, and post-action review evidence when emergency administration was used

## Related References

- [Production Reference Architecture](production-reference-architecture.md)
- [Security Model](security-model.md)
- [Deployment Runbook](deployment-runbook.md)
- [Evidence Catalog](evidence-catalog.md)
- [Degraded Mode Operations Runbook](../runbooks/degraded-mode-operations.md)
