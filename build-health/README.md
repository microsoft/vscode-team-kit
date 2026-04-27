# Build Health

Quickly diagnose the VS Code rolling build health. Downloads recent builds from Azure DevOps, fetches failure logs, and produces a detailed report with break/fix transitions, error messages, and commit links.

## Skills

- **[build-health](./skills/build-health/SKILL.md)** — Fetch and analyze rolling build data from Pipeline 111.

## Quick Start

```sh
# 1. Fetch last 100 builds (needs `az` CLI authenticated)
bash ./skills/build-health/scripts/fetch-builds.sh --count 100 --out /tmp/build-health

# 2. Generate a stable markdown report (runs offline)
node ./skills/build-health/scripts/analyze-builds.mjs /tmp/build-health --format markdown --report /tmp/build-health/build-health-report.md

# 3. Optional: print a terminal-friendly text view
node ./skills/build-health/scripts/analyze-builds.mjs /tmp/build-health --format text
```

## Prerequisites

- Azure CLI (`az`) — `brew install azure-cli`
- Logged in — `az login`
- Node.js on PATH
- The `azure-devops` extension auto-installs on first use
