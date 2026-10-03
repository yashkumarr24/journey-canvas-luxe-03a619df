#!/usr/bin/env bash
# Run the package importer from the backend folder using its virtualenv.
# Usage: tools/package_import.sh --source /path/to/international-packages [--mode dry-run|import --confirm IMPORT-PACKAGES]
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d .venv ] || { echo "Create the venv first: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"; exit 2; }
STAMP=$(date -u +%Y%m%d-%H%M%S)
exec .venv/bin/python -m app.diagnostics.package_import --report-dir "import-reports/$STAMP" "$@"
