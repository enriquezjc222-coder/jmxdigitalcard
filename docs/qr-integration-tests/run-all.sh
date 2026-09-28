#!/usr/bin/env bash
# Runs every automated check against THIS folder (no Firebase project, no deploy, no network).
# Needs: node 20+, python3 + opencv-python + numpy, playwright + chromium.
# Firebase Emulator rules tests are separate: docs/emulator-tests/README.md
set -euo pipefail
cd "$(dirname "$0")/../.."
PYTHON_BIN="${PYTHON_BIN:-python3}"
echo "== 1/6 syntax"
for f in script.js admin.js dashboard.js js/*.js js/jmx-qr/*.js functions/index.js functions/plan-resolver.js \
         tools/inventory-audit/*.mjs tools/inventory-audit/lib/*.mjs tools/inventory-audit/test/*.mjs \
         docs/emulator-tests/*.mjs docs/qr-integration-tests/*.mjs docs/qr-integration-tests/mock-firebase/*.js; do node --check "$f"; done
echo "== 2/6 Cloud Functions module loads ($(node -v))"
if [ -d functions/node_modules ]; then node -e "const m=require('./functions/index.js');console.log('exports:',Object.keys(m).length)"; else echo "SKIPPED: functions/node_modules not installed (run: npm --prefix functions ci)"; fi
echo "== 3/6 unit";            node --test docs/qr-integration-tests/unit.test.mjs
echo "== 4/6 inventory audit"; node --test tools/inventory-audit/test/audit.test.mjs
echo "== 5/6 integrated";      node --test --test-concurrency=1 docs/qr-integration-tests/integration.test.mjs
echo "== 6/6 scan matrix";     "$PYTHON_BIN" docs/qr-integration-tests/scan_matrix.py
echo "ALL CHECKS PASSED"
