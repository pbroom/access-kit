Produce a repo-native, best-in-class documentation foundation for the access-kit ReBAC authorization control plane, executed as staged, reviewable work under one umbrella Goal.

This repository is for an API-first and CLI-first ReBAC authorization control plane intended for ATO-ready government and enterprise environments. The documentation must make the system buildable, operable, inspectable, auditable, and authorizable.

Important completion rule:
“Complete” does not mean mechanically creating every previously requested path. Complete means producing the documentation foundation while preserving the repository’s canonical conventions, avoiding duplicate sources of truth, and recording all path-equivalence decisions.

Core product framing:
- The system is a relationship-aware authorization control plane.
- It manages subjects, resources, relationships, policy models, decisions, explanations, grants, native grants, provisioning plans, connector actions, drift findings, audit events, and evidence objects.
- It is API-first and CLI-first.
- It is deterministic, explainable, versioned, auditable, and deny-by-default.
- It supports ATO inspection by connecting architecture, controls, implementation behavior, evidence, logs, schemas, APIs, CLI commands, runbooks, and control mappings.

Non-goals:
- It is not an identity provider.
- It is not an authentication system.
- It is not a SIEM.
- It is not a ticketing system.
- It is not a generic workflow platform.
- It is not a replacement for Entra ID, Active Directory, AWS IAM, SharePoint permissions, Teams membership, Power Platform security roles, or application-specific enforcement.
- It is not a UI-first admin portal.
- It is not an LLM-based access decision engine.
- No LLM may make authorization decisions.

Canonicalization and path-equivalence rules:
1. Existing canonical repo artifacts win over previously requested filenames unless the requested artifact is semantically distinct.
2. Do not create duplicate near-equivalent files just to satisfy an earlier requested path.
3. For ADRs, preserve the repo’s existing naming convention, such as adrs/0001-api-first-cli-first.md. Do not create parallel ADR-0001-* files.
4. For schemas, preserve existing specific schema names, such as schemas/evidence-export.schema.json. Do not create schemas/evidence.schema.json unless it represents a distinct evidence-object contract.
5. For docs, either enrich existing flat docs or perform a deliberate flat-to-nested migration. Do not leave two parallel authoritative docs for the same concept.
6. If a file is moved, update README links, docs links, scripts, validation references, examples, and tests as needed.
7. If a requested artifact maps to an existing canonical artifact, update the existing artifact and record the mapping.
8. If a new artifact is needed, name it according to the repo’s existing conventions.
9. Add a docs/docs-readiness-report.md section called “Path Equivalence Decisions” that records requested path, canonical repo path, action taken, and rationale.
10. Additions must be justified by distinct meaning, not filename matching.

Start by:
- creating or using an isolated worktree/branch suitable for reviewable stack work
- inspecting the current repository structure
- identifying existing near-equivalent docs, ADRs, schemas, examples, and runbooks
- building the path-equivalence map before writing substantive new docs
- deciding whether each requested artifact should be reused, enriched, migrated, renamed, or newly created
- recording those decisions in docs/docs-readiness-report.md

The documentation must serve these audiences:
- application developers
- platform engineers
- security engineers
- ISSOs
- assessors
- resource owners
- product/governance leads

Flagship pages must get the full treatment:
Each flagship page must include:
- purpose
- audience
- what this is
- what this is not, where useful
- core concepts
- concrete example
- security considerations
- audit/evidence implications
- related controls, where applicable
- related API, CLI, schema, runbook, ADR, or evidence references

Flagship pages:
- Concept of Operations
- System Context and Boundary
- Domain Model
- Decision Lifecycle
- Provisioning Lifecycle
- Explain API
- Audit Event Model
- Connector Contract
- Drift Detection Model
- Evidence Catalog
- Control Traceability Matrix
- Assessor Inspection Guide
- Threat Model
- Policy Testing Guide
- Emergency Revocation Runbook

Non-flagship docs can be more concise, but must still be useful, internally consistent, and navigable.

Required documentation coverage:
The repo must contain or canonically map to documentation covering:
- start-here overview
- concept of operations
- glossary
- non-goals
- system context
- system boundary
- data flows
- trust boundaries
- decision lifecycle
- provisioning lifecycle
- reconciliation/drift lifecycle
- domain model
- API overview
- Decision API
- Explain API
- API errors
- reason codes
- CLI overview
- CLI commands
- policy model
- policy testing
- connector contract
- connector capability model
- security model
- threat model
- audit logging
- tamper evidence
- ATO overview
- control traceability matrix
- evidence catalog
- assessor inspection guide
- runbooks
- ADRs
- schemas
- examples
- OSCAL placeholders or OSCAL guidance, where appropriate
- docs-readiness report

Required runbook coverage:
The repo must contain or canonically map to runbooks for:
- emergency revocation
- policy rollback
- drift remediation
- connector outage
- break-glass review
- audit/evidence export
- compromised connector credential, if appropriate
- decision API outage, if appropriate

Each runbook must include:
- purpose
- trigger
- severity
- required role
- prerequisites
- commands or proposed commands
- expected output
- verification steps
- audit events emitted
- evidence retained
- escalation path
- rollback or compensating action, where applicable

Required schema/example coverage:
The repo must contain or canonically map to schemas and examples for:
- audit event
- decision
- explain response
- relationship
- provisioning plan
- drift finding
- evidence export or evidence object, depending on existing schema semantics
- synthetic API examples
- synthetic CLI examples, where appropriate
- synthetic policy tests
- synthetic control/evidence mapping examples

Schema additions must be justified:
- Reuse existing schemas when they already define the needed contract.
- Add a new schema only when it represents a distinct object or contract.
- If both atomic evidence objects and evidence export packages are needed, name them distinctly, for example evidence-object versus evidence-export.

Documentation quality rules:
- Use synthetic examples only.
- Do not use real tenant IDs, user IDs, emails, access tokens, secrets, client names, government system names, production logs, or sensitive architecture details.
- Do not claim live Microsoft, AWS, Power Platform, SharePoint, Teams, Entra ID, Active Directory, or Azure connector behavior unless it is explicitly implemented in the repo or clearly marked as planned/draft.
- Do not overclaim ATO, FedRAMP, NIST, or compliance status.
- Use wording such as “ATO-ready,” “ATO-oriented,” “ATO-inspectable,” or “supports ATO evidence” unless actual authorization status exists in the repo.
- Mark assumptions clearly.
- Distinguish implemented behavior from proposed behavior.
- Keep source-of-truth concepts clear:
- relationship facts
- policy rules
- authorization decisions
- explanations
- intended grants
- native grants
- provisioning actions
- drift findings
- audit evidence
- ATO evidence

Architecture and control documentation must make these distinctions clear:
- Authentication remains with systems such as Entra ID, AD, federation, IAM Identity Center, or approved IdPs.
- ReBAC is the authorization control plane, not the authentication authority.
- Native platforms still enforce access locally where applicable.
- The ReBAC foundation decides, explains, provisions, verifies, reconciles, audits, and produces evidence.
- Authorization decisions are deterministic and reproducible.
- Every decision should be traceable to policy version, relationship version, reason code, and correlation ID.
- Provisioning should use plan, dry-run, apply, verify, audit, and reconcile patterns.
- Drift is a first-class security finding.
- Revocation and expiration are first-class behaviors, not afterthoughts.

Required docs/docs-readiness-report.md sections:
- Executive summary
- Documentation coverage
- Flagship page coverage
- Path Equivalence Decisions
- Existing artifacts reused
- New artifacts added
- Artifacts migrated or renamed
- Schemas and examples coverage
- Runbook coverage
- ATO/control/evidence coverage
- Validation performed
- Validation not performed and why
- Known gaps
- Assumptions
- Blockers
- Recommended next steps

The “Path Equivalence Decisions” section must include a table like:
- requested path
- canonical repo path
- action taken
- rationale

Example decisions to handle:
- adrs/ADR-0001-api-cli-first.md should map to the existing canonical ADR naming convention if an equivalent exists.
- adrs/ADR-0002-deterministic-authorization.md should map to the existing deterministic authorization ADR if present.
- schemas/evidence.schema.json should map to schemas/evidence-export.schema.json if the intended artifact is an evidence export package.
- Create a distinct evidence-object schema only if the repo needs a separate atomic evidence object contract.

Validation expectations:
- Run the repo’s available validation commands where possible.
- Validate JSON examples against schemas where possible.
- Validate YAML examples where possible.
- Check docs links where tooling exists.
- Check that generated or referenced API/CLI/schema docs remain internally consistent.
- If validation cannot run, explain why in the docs-readiness report.
- Do not hide validation failures. Record them and, where feasible, fix them.

Work style:
- Execute as staged, reviewable stack work under this umbrella Goal.
- Stage 1: repo inspection, canonical artifact mapping, path-equivalence decisions, docs IA.
- Stage 2: flagship content.
- Stage 3: schemas, examples, templates, runbooks, ADR updates.
- Stage 4: validation, link/reference cleanup, docs-readiness hardening.
- Keep changes coherent and reviewable.
- Prefer enriching existing canonical files over creating parallel sources of truth.
- If a flat-to-nested docs migration is performed, make it deliberate and update all references.

The Goal is complete only when:
- the documentation foundation exists using canonical repo conventions
- duplicate near-equivalent authoritative files have been avoided
- path-equivalence decisions are recorded
- flagship pages are substantive
- non-flagship support docs are useful and navigable
- schemas/examples/templates/runbooks are present or canonically mapped
- ATO/control/evidence relationships are visible
- validation has been run where possible
- docs/docs-readiness-report.md accurately summarizes coverage, gaps, validation, assumptions, blockers, and recommended next steps

If required source truth is missing, implementation contracts are absent, or validation cannot be completed, stop with a clear report of:
- completed work
- blockers
- uncertainty
- exact input needed to proceed