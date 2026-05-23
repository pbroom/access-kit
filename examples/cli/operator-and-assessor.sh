#!/usr/bin/env sh
set -eu

# Synthetic operator and assessor walkthrough.
# Requires a running Access Kit API and REBAC_API_URL when not using the default local URL.

rebac connector list
rebac connector test mock
rebac connector sync mock --mode read_only
rebac discovery runs --connector mock

rebac check user:alice read document:case-plan
rebac explain user:alice read document:case-plan

rebac resource native-access document:case-plan --connector mock --subject user:alice
rebac reconcile run --connector mock --dry-run
rebac reconcile findings --severity high

rebac audit integrity
rebac audit export \
  --from 2026-05-01T00:00:00.000Z \
  --to 2026-05-31T23:59:59.000Z \
  --target operator_download

rebac evidence export \
  --framework nist-800-53 \
  --controls AC-2,AC-3,AU-2,AU-6,CA-7 \
  --from 2026-05-01T00:00:00.000Z \
  --to 2026-05-31T23:59:59.000Z \
  --format json
