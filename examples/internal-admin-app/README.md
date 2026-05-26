# Internal Admin App Sample

This sample shows how an internal administration surface can call Access Kit without collapsing elevated operator power into application authorization. It is synthetic, uses no live tenant data, and is meant for tests, demos, and assessor walkthroughs.

## Admin Control Boundary

The sample starts only after the `admin-authorization:v1` readiness contract passes with an IdP-backed gateway, MFA, bounded sessions, fast revocation, external secret references, incident notification targets, break-glass approval, post-action review, and exportable admin audit events.

Local bearer-token proof points are intentionally blocked from production admin readiness. The sample does not create a password store, does not read checked-in secrets, and does not trust application-local roles.

## Least Privilege Admin Roles

The sample uses a separate admin ReBAC seed in `app.ts`. It is separate from the application authorization graph used for protected resource decisions.

| Role binding | Allowed sample behavior |
| --- | --- |
| `group:admin-operators` | Read the access-review case and perform safe review lookups. |
| `group:admin-auditors` | Read the admin console and access-review case when approval evidence is attached. |
| `group:admin-approvers` | Manage exception approvals in the admin console. |
| `group:break-glass-responders` | Request emergency elevation only through the break-glass boundary. |

Application users can still have normal application access, but that access does not authorize admin actions.

## Approval And Access Review Evidence

Sensitive admin actions include `AccessReviewContext` and `ApprovalEvidence` values. Approval evidence must include a `CHG-*` change ticket, an unexpired approval window, the access-review identifier, and the required approver roles for emergency actions.

The safe explain flow uses the application decision engine to compute an explanation, then returns only a bounded summary: decision ID, reason code, versions, constraint keys, and relationship path length. Raw relationship path entries are not exposed in the admin response body.

## Break Glass Boundary

Break-glass behavior is not a standing console-admin grant. The sample requires an incident ID, a substantial justification, multi-role approval, a duration inside the descriptor maximum, and a post-action review identifier. The response records that post-action review is required and that standing admin authorization remains false.

## Audit Traceability

Each admin request records the Access Kit admin decision event plus an `admin.action`, `admin.action_denied`, `admin.approval_required`, or `admin.break_glass_denied` audit event with the caller correlation ID. Safe explain requests also preserve the underlying application decision ID so reviewers can trace the redacted summary back to the deterministic decision record.

Run the focused sample checks with:

```sh
pnpm validate:sample-admin-app
```
