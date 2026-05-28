# Production Reference Overlay

This overlay documents the production deployment boundary for `rebac-api`. It is a Kustomize starting point for platform teams to adapt after selecting environment-specific services.

The files in this directory contain references and annotations only. They must not contain real tenant IDs, hostnames, account IDs, secret values, tokens, certificates, or provider credentials.

## Files

| File | Purpose |
| --- | --- |
| `kustomization.yaml` | Composes the base Kubernetes proof-point manifests and production-reference patches. |
| `patches/runtime-config.yaml` | Adds evidence-reference configuration placeholders for external graph, queue, audit, SIEM, gateway, secrets, observability, backup, RTO, and RPO controls. |
| `patches/deployment-controls.yaml` | Annotates the API deployment with required production control evidence. |

## Required Replacements

- replace the base image digest with the signed release digest verified through GitHub attestation and cosign
- provide external secret references through the target cluster's approved secret delivery mechanism
- configure the IdP or mTLS gateway outside this overlay and retain descriptor evidence
- select graph, connector-state, queue, audit/evidence, SIEM, observability, and backup services
- run environment-specific IaC validation before promotion

## Validation

Run these repo checks after adapting the overlay:

```sh
pnpm validate:deployment-manifests
pnpm validate:persistence-deployment
pnpm validate:docs
```

Run `pnpm ci:check` before opening a production architecture or deployment PR.
