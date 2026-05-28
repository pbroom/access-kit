# Evidence Integrity Verifier

Evidence exports include an `integrityManifest`, signed package metadata, and verifier checks so assessors can reproduce package and section hashes without relying on the local file-backed evidence repository.

## Verification Steps

1. If the package includes `storageReceipt`, remove it before recomputing the package hash.
2. Remove `integrityManifest` from the remaining package.
3. Remove `signedPackage` and `verifierChecks`; those are attestation metadata around the evidence content.
4. Canonicalize the package content with the same stable JSON key ordering used by Access Kit.
5. Compute SHA-256 over the canonical package content and compare it with `integrityManifest.packageHash`.
6. For every entry in `integrityManifest.sections`, canonicalize the named evidence section, compute SHA-256, and compare it with the recorded `hash`.
7. Verify `signedPackage.packageHash` matches `integrityManifest.packageHash`, verify `signedPackage.signature` over the signed metadata with the trusted public key for `signedPackage.keyId`, and confirm each control trace points to the signed package, reviewed statement metadata, source events, and deployment scope.

The CLI exposes the same checks:

```sh
rebac evidence verify --package evidence-export.json
```

The manifest and local proof signature record hashes, counts, trace references, and deployment scope only. They must not introduce secrets, bearer tokens, provider credentials, or raw tenant payloads. The local proof signature is verified against a trusted key record for the proof-point package; production deployments still need environment-managed signing keys and approved evidence retention.
