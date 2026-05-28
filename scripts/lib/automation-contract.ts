export interface PackageScriptContract {
  readonly name: string;
  readonly command: string;
}

export interface ValidationPlanContract {
  readonly name: string;
  readonly script: string;
  readonly requiredScripts: readonly string[];
}

export interface LabelContract {
  readonly name: string;
  readonly color: string;
  readonly description: string;
}

export interface WorkflowJobContract {
  readonly name: string;
  readonly requiredRuns?: readonly string[];
  readonly requiredRunSnippets?: readonly string[];
  readonly requiredUses?: readonly string[];
}

export interface WorkflowContract {
  readonly path: string;
  readonly jobs: readonly WorkflowJobContract[];
  readonly cancelInProgress?: boolean;
}

export interface EvidenceCommandContract {
  readonly name: string;
  readonly args: readonly string[];
}

export interface AutomationContract {
  readonly version: "automation-contract:v1";
  readonly backlog: {
    readonly statuses: readonly string[];
    readonly parallelValues: readonly string[];
    readonly defaultBatchSize: number;
    readonly maxBatchSize: number;
  };
  readonly validationPlans: readonly ValidationPlanContract[];
  readonly packageScripts: readonly PackageScriptContract[];
  readonly nodeImportTsxScripts: readonly string[];
  readonly labels: {
    readonly definitions: readonly LabelContract[];
    readonly state: readonly string[];
    readonly humanWait: readonly string[];
    readonly mergeBlockers: readonly string[];
    readonly stackMembership: readonly string[];
    readonly readyToMerge: string;
    readonly securityPassRequired: string;
  };
  readonly docs: {
    readonly automationRequiredText: readonly string[];
  };
  readonly ci: {
    readonly automationGateCommand: string;
    readonly workflows: readonly WorkflowContract[];
    readonly prStewardWorkflow: {
      readonly path: string;
      readonly requiredText: readonly string[];
      readonly minPipefailCount: number;
    };
  };
  readonly evidence: {
    readonly commands: readonly EvidenceCommandContract[];
    readonly coveredProofPoints: readonly string[];
    readonly outstandingRequirements: readonly string[];
  };
}

export const automationContract = {
  version: "automation-contract:v1",
  backlog: {
    statuses: ["ready", "in_progress", "in_review", "blocked", "merged"],
    parallelValues: ["yes", "no"],
    defaultBatchSize: 3,
    maxBatchSize: 5
  },
  validationPlans: [
    {
      name: "repository validation",
      script: "validate",
      requiredScripts: [
        "typecheck",
        "validate:contracts",
        "validate:sample-policy",
        "validate:automation",
        "validate:ci",
        "validate:packaging",
        "validate:release-packaging",
        "validate:deployment-manifests",
        "validate:persistence-deployment",
        "test"
      ]
    },
    {
      name: "CI parity check",
      script: "ci:check",
      requiredScripts: [
        "validate:contracts",
        "validate:sample-policy",
        "validate:docs",
        "validate:automation",
        "validate:ci",
        "validate:packaging",
        "validate:release-packaging",
        "validate:deployment-manifests",
        "validate:persistence-deployment",
        "typecheck",
        "lint",
        "test",
        "build",
        "evidence:check"
      ]
    },
    {
      name: "security pass",
      script: "security:pass",
      requiredScripts: ["audit", "diff --check", "ci:check"]
    }
  ],
  packageScripts: [
    { name: "validate:automation", command: "tsx scripts/validate-automation-contracts.ts" },
    { name: "validate:sample-policy", command: "tsx scripts/validate-sample-policy-repository.ts" },
    { name: "pr:status", command: "node --import tsx scripts/pr-steward.ts --dry-run" },
    { name: "steward:check", command: "node --import tsx scripts/pr-steward.ts --dry-run" },
    { name: "backlog:batch", command: "node --import tsx scripts/backlog-batch.ts" },
    { name: "backlog:next", command: "node --import tsx scripts/next-slice.ts" },
    { name: "stack:ready", command: "node --import tsx scripts/stack-ready.ts" },
    { name: "security:pass", command: "pnpm audit --audit-level high && git diff --check && pnpm ci:check" },
    { name: "labels:sync", command: "node --import tsx scripts/sync-github-labels.ts" },
    { name: "labels:check", command: "node --import tsx scripts/sync-github-labels.ts --check" },
    { name: "automation:doctor", command: "node --import tsx scripts/automation-doctor.ts" },
    {
      name: "validate:connector-security",
      command: "node --conditions=types --import tsx scripts/validate-connector-security-gate.ts"
    }
  ],
  nodeImportTsxScripts: [
    "pr:status",
    "steward:check",
    "backlog:batch",
    "backlog:next",
    "stack:ready",
    "labels:sync",
    "labels:check",
    "automation:doctor"
  ],
  labels: {
    definitions: [
      {
        name: "stack",
        color: "1f6feb",
        description: "Pull request belongs to a stacked implementation sequence."
      },
      {
        name: "ready-for-automation",
        color: "2ea043",
        description: "Automation may resolve CI, review, or contract issues without a new scope decision."
      },
      {
        name: "needs-human",
        color: "d29922",
        description: "Human decision is required before more implementation work continues."
      },
      {
        name: "security-pass-required",
        color: "db6d28",
        description: "Local security pass is required before this work can be marked merge-ready."
      },
      {
        name: "blocked",
        color: "cf222e",
        description: "Work is blocked by an external dependency or unresolved product decision."
      },
      {
        name: "ready-to-merge",
        color: "238636",
        description: "Human-approved PR with passing checks and no known merge blockers."
      },
      {
        name: "next-slice",
        color: "8250df",
        description: "Candidate for the next implementation slice after the current stack merges."
      }
    ],
    state: ["ready-for-automation", "needs-human", "blocked", "ready-to-merge"],
    humanWait: ["needs-human", "blocked"],
    mergeBlockers: ["blocked", "needs-human", "security-pass-required"],
    stackMembership: ["stack", "ready-to-merge"],
    readyToMerge: "ready-to-merge",
    securityPassRequired: "security-pass-required"
  },
  docs: {
    automationRequiredText: [
      "pnpm pr:status",
      "pnpm backlog:batch",
      "pnpm stack:ready",
      "pnpm security:pass",
      "pnpm automation:doctor",
      "scripts/lib/automation-contract.ts",
      "ready-for-automation",
      "needs-human",
      "ready-to-merge"
    ]
  },
  ci: {
    automationGateCommand: "pnpm validate:automation",
    workflows: [
      {
        path: ".github/workflows/ci.yml",
        jobs: [
          {
            name: "contract-validation",
            requiredRuns: [
              "pnpm validate:contracts",
              "pnpm validate:connector-security",
              "pnpm validate:docs",
              "pnpm validate:automation",
              "pnpm validate:ci",
              "pnpm validate:packaging",
              "pnpm validate:release-packaging",
              "pnpm validate:deployment-manifests",
              "pnpm validate:persistence-deployment"
            ]
          },
          {
            name: "quality",
            requiredRuns: ["pnpm typecheck", "pnpm lint", "pnpm test", "pnpm build"]
          },
          {
            name: "policy-tests",
            requiredRuns: ["pnpm validate:sample-policy"]
          },
          {
            name: "evidence",
            requiredRuns: ["pnpm evidence:check"]
          },
          {
            name: "container-packaging",
            requiredRuns: [
              "docker build --target runtime --tag access-kit-rebac-api:${{ github.sha }} ."
            ],
            requiredRunSnippets: [
              "rebac-api-smoke",
              "did not become healthy within 20 seconds",
              "/v1/ready",
              "REBAC_API_KEYS=ci-smoke"
            ]
          }
        ]
      },
      {
        path: ".github/workflows/security.yml",
        cancelInProgress: false,
        jobs: [
          {
            name: "dependency-audit",
            requiredRuns: ["pnpm audit --audit-level high"]
          },
          {
            name: "secret-scan",
            requiredUses: ["gitleaks/gitleaks-action"]
          },
          {
            name: "codeql",
            requiredUses: ["github/codeql-action/init", "github/codeql-action/analyze"],
            requiredRuns: ["pnpm build"]
          }
        ]
      }
    ],
    prStewardWorkflow: {
      path: ".github/workflows/pr-steward.yml",
      requiredText: ["pnpm steward:check", "pnpm backlog:batch", "schedule:"],
      minPipefailCount: 2
    }
  },
  evidence: {
    commands: [
      { name: "typecheck", args: ["typecheck"] },
      { name: "schema validation", args: ["validate:schemas"] },
      { name: "OpenAPI validation", args: ["validate:openapi"] },
      { name: "policy fixture validation", args: ["validate:policy"] },
      { name: "connector security gate validation", args: ["validate:connector-security"] },
      { name: "CLI command contract", args: ["validate:cli-contract"] },
      { name: "container packaging validation", args: ["validate:packaging"] },
      { name: "release packaging validation", args: ["validate:release-packaging"] },
      { name: "deployment manifest validation", args: ["validate:deployment-manifests"] },
      { name: "persistence deployment evidence validation", args: ["validate:persistence-deployment"] },
      { name: "core engine tests", args: ["test:core"] },
      { name: "API runtime tests", args: ["test:api"] },
      { name: "connector package tests", args: ["exec", "vitest", "run", "tests/connectors"] },
      { name: "CLI API smoke tests", args: ["test:cli"] }
    ],
    coveredProofPoints: [
      "TypeScript strict type checking.",
      "JSON Schema validation for subject, resource, relationship, decision, native grant, discovery run, connector-security-review, enforcement-readiness, provisioning plan, audit event, audit export, drift finding, audit-integrity, persistence-deployment manifest, persistence-deployment readiness, and evidence export examples.",
      "OpenAPI validation for required readiness, decision, inventory, native access, discovery, relationship, policy, provisioning, reconciliation, audit, audit-integrity, audit-export, evidence, connector, enforcement-readiness, generated client metadata, contract snapshots, versioning, deprecation, authentication, rate-limit, and API example path groups.",
      "Policy fixtures for deny by default, relationship allow, deny override, expired access denial, suspended-user denial, idempotency, and drift finding.",
      "Connector security gate validation for connector identity, consent, tenant boundary, least-privilege read scopes, approved Microsoft Graph and AWS live-read scopes, pagination, throttling, deletion semantics, coverage-warning requirements, secret handling, and no-write defaults.",
      "CLI command contract mapping each operator command to an API surface.",
      "Deployable API container packaging validation for the Dockerfile, non-root runtime, /v1/ready healthcheck, API auth smoke path, and CI job.",
      "Release packaging validation for GHCR publishing gates, SBOM/provenance metadata, GitHub artifact attestation, and keyless cosign signing.",
      "Deployment manifest validation for Kubernetes probe wiring, secret references, persistent state/evidence mounts, restricted runtime security, network policy, immutable image digests, and signed-image admission policy.",
      "Persistence deployment evidence validation for the production manifest schema, retained readiness report artifact, external backend readiness, IaC output references, release approval, backup/restore, operator controls, and blocked local proof-point manifests.",
      "Local core engine tests for deterministic check/explain, decision audit emission, shared graph and connector-state repository conformance across in-memory, local JSON, production external, and production queue adapters, local JSON graph persistence and tamper checks, local append-only audit persistence and tamper findings, local JSON job persistence and idempotency lookups, production graph, connector-state, queue, and audit/evidence tenant/secret/backup checks, production audit signed windows, SIEM delivery monitoring, replay, immutable evidence receipts, tamper detection, queue idempotency, priority, retry, dead-letter, replay, connector-health semantics, admin authorization readiness for IdP or mTLS gateway controls, internal admin ReBAC, secrets-manager references, break-glass, incident notification, and post-action review, persistence-readiness gates for graph, audit, and job backends, and production persistence manifest readiness checks.",
      "API runtime tests for health, readiness probes, optional bearer-token API guarding, audited authentication failures, admin authorization readiness reporting without token, claim, header, certificate, connector, or secret leakage, decision, relationship write audit, read-only mock and synthetic provider connector discovery, repository-backed discovery run history, native access filtering, drift finding and reconciliation recovery, dry-run provisioning jobs, enforcement-readiness reports, controlled synthetic enforcement guardrails, audit integrity, SIEM-ready audit export, local file-backed audit/evidence storage, production audit/evidence adapter runtime persistence, restartable JSON runtime state snapshots, API service runtime config, complete local ATO evidence packaging, access-review and exception evidence, idempotent job replay, reconciliation, queued discovery, queued provisioning, queued evidence, queued revocation, and execution-time queue enforcement revalidation.",
      "Connector package tests for Microsoft Graph Entra and AWS read-only inventory, native grants, pagination, throttling, redaction, no-write, security-gate, and optional runtime-registration behavior, plus the sample read-only connector template for synthetic fixtures, tombstones, stale-grant replacement, redacted evidence, fail-closed provisioning hooks, and intentional security-gate registration.",
      "CLI API smoke tests for operator, CI/CD, assessor, audit-integrity, SIEM-ready audit export, ATO evidence export, dry-run provisioning, connector readiness, and controlled synthetic enforcement surfaces calling the API.",
      "Generated API client tests for bearer authentication, idempotency headers, fail-closed protected calls, and retry-after error propagation."
    ],
    outstandingRequirements: [
      "Select and configure an environment-specific production relationship graph and policy model store driver behind the production graph adapter.",
      "Select and configure an environment-specific WORM or immutable-ledger driver behind the production audit/evidence adapter.",
      "Select and configure an environment-specific queue driver behind the production queue/job adapter.",
      "Replace synthetic production persistence manifest evidence with environment-specific IaC outputs, approvals, and retained evidence artifacts.",
      "Replace local release and deployment-manifest proof points with environment-specific registry promotion approvals, enforced signed-image admission, IaC overlays for ingress/certificates/storage/networking, identity-provider-backed authentication, and operator authorization.",
      "Replace local bearer-token admin proof points with environment-specific IdP or mTLS gateway deployment, trusted identity propagation, separate admin ReBAC policy, secrets-manager integration, incident-mode notifications, break-glass approval, post-action review evidence, and request-scoped admin actor binding.",
      "Replace local audit integrity, SIEM-ready audit exports, JSON snapshots, local append-only audit proof points, and adapter-level SIEM delivery metadata with deployment-specific durable audit storage, approved SIEM forwarding, retention, alert routing, and replay evidence.",
      "Retain live Microsoft Graph and AWS sandbox evidence for environment-specific verification, and replace remaining synthetic SharePoint readback fixtures with live read-only connector discovery after connector security review.",
      "Select and configure environment-specific production connector-state storage behind the production connector-state adapter for discovery runs, native-grant readback, drift findings, and reconciliation evidence.",
      "Deploy managed queue workers with production monitoring, retry, dead-letter, replay, and emergency revocation operating procedures.",
      "Extend enforcement beyond the synthetic mock connector only after approval workflow, rollback, operational runbooks, emergency revocation behavior, and connector least-privilege review are complete.",
      "Replace local ATO package proof points with deployment-specific diagrams, assessor-reviewed control statements, retained SBOM/security artifacts, access review campaigns, exception workflow, backup/restore test evidence, and ConMon delivery."
    ]
  }
} as const satisfies AutomationContract;
