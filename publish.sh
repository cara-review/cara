#!/usr/bin/env bash
# Release cara to npm: sync main → clean install → full gate → publish.
#
# 2FA is handled by npm's interactive OTP prompt — do NOT pass --otp here.
# `npm publish` runs the `prepublishOnly` script, which builds the publishable
# dist (web bundle + bundled cli, sourcemaps trimmed) before uploading.
#
# Prereqs: on `main`, clean tree, bumped version in package.json, npm logged in,
# and Chromium installed for e2e (`bunx playwright install chromium`).

set -euo pipefail
cd "$(dirname "$0")"

# Guard: release only from a clean main.
[[ "$(git rev-parse --abbrev-ref HEAD)" == "main" ]] || { echo "Not on main — switch to main first." >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "Working tree is dirty — commit or stash first." >&2; exit 1; }

git pull --ff-only origin main

# Clean, lockfile-faithful install.
rm -rf node_modules
bun install --frozen-lockfile

# Full quality gate.
bun run lint
bun run test
bun run test:e2e

# Publish (prepublishOnly builds dist; npm prompts for the OTP interactively).
npm publish

echo "Published cara@$(bun -e 'console.log(require("./package.json").version)')"
