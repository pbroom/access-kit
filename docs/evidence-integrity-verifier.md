# Evidence Integrity Verifier

Evidence exports include an `integrityManifest` so assessors can reproduce package and section hashes without relying on the local file-backed evidence repository.

## Verification Steps

1. If the package includes `storageReceipt`, remove it before recomputing the package hash.
2. Remove `integrityManifest` from the remaining package.
3. Canonicalize the package with the same stable JSON key ordering used by Access Kit.
4. Compute SHA-256 over the canonical package and compare it with `integrityManifest.packageHash`.
5. For every entry in `integrityManifest.sections`, canonicalize the named evidence section, compute SHA-256, and compare it with the recorded `hash`.

The manifest records hashes and counts only. It must not introduce secrets, bearer tokens, provider credentials, or raw tenant payloads.
