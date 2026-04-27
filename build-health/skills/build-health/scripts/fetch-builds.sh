#!/usr/bin/env bash
# fetch-builds.sh — Download recent rolling builds + timelines + failure logs
# from the VS Code Azure DevOps pipeline.
#
# Usage:
#   ./fetch-builds.sh [--count N] [--out DIR]
#
# Defaults:
#   --count 100      Number of recent main-branch builds to fetch
#   --out ./build-data   Output directory
#
# Prerequisites:
#   - Azure CLI (`az`) installed and logged in
#   - `az devops` extension (auto-installs if missing)
#   - `python3` on PATH

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
COUNT=100
OUT_DIR="./build-data"
ORG="https://dev.azure.com/monacotools"
PROJECT="Monaco"
PIPELINE_ID=111
BRANCH="main"
BATCH_SIZE=10

# ── Parse args ────────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --count) COUNT="$2"; shift 2 ;;
    --out)   OUT_DIR="$2"; shift 2 ;;
    --pipeline) PIPELINE_ID="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

mkdir -p "$OUT_DIR/timelines" "$OUT_DIR/logs"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Build Health — Fetching data from Azure DevOps             ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Pipeline:  $PIPELINE_ID"
echo "║  Branch:    $BRANCH"
echo "║  Count:     $COUNT"
echo "║  Output:    $OUT_DIR"
echo "╚══════════════════════════════════════════════════════════════╝"
echo

# ── Ensure az devops defaults ─────────────────────────────────────────────────
az devops configure --defaults organization="$ORG" project="$PROJECT" 2>/dev/null || true

# ── Step 1: Download build runs ──────────────────────────────────────────────
echo "▸ Step 1/3: Downloading $COUNT recent builds on '$BRANCH'..."
az pipelines runs list \
  --pipeline-ids "$PIPELINE_ID" \
  --branch "$BRANCH" \
  --query-order FinishTimeDesc \
  --top "$COUNT" \
  --output json 2>/dev/null > "$OUT_DIR/runs.json"

BUILD_COUNT=$(python3 -c "import json; print(len(json.load(open('$OUT_DIR/runs.json'))))")
echo "  ✓ Downloaded $BUILD_COUNT builds"

# ── Step 2: Download timelines for failed/partial builds ─────────────────────
echo
echo "▸ Step 2/3: Downloading timelines for failed/partial builds..."

# Get list of build IDs that need timelines
NEEDS_TIMELINE=$(python3 -c "
import json
data = json.load(open('$OUT_DIR/runs.json'))
ids = [str(b['id']) for b in data if b.get('result') in ('failed', 'partiallySucceeded')]
print(' '.join(ids))
")

TIMELINE_TOTAL=$(echo "$NEEDS_TIMELINE" | wc -w | tr -d ' ')
echo "  $TIMELINE_TOTAL builds need timelines"

TIMELINE_COUNT=0
for id in $NEEDS_TIMELINE; do
  if [[ -f "$OUT_DIR/timelines/${id}.json" ]]; then
    TIMELINE_COUNT=$((TIMELINE_COUNT + 1))
    continue
  fi
  az devops invoke \
    --area build --resource timeline \
    --route-parameters buildId="$id" project="$PROJECT" \
    --org "$ORG" --output json 2>/dev/null > "$OUT_DIR/timelines/${id}.json" &
  TIMELINE_COUNT=$((TIMELINE_COUNT + 1))
  if (( TIMELINE_COUNT % BATCH_SIZE == 0 )); then
    wait
    echo "  $TIMELINE_COUNT / $TIMELINE_TOTAL"
  fi
done
wait
echo "  ✓ $TIMELINE_COUNT timelines downloaded"

# ── Step 3: Download logs for key failing tasks ──────────────────────────────
echo
echo "▸ Step 3/3: Downloading failure logs..."

# Extract (buildId, logId, jobName, taskName) for interesting failing tasks
LOG_TARGETS=$(python3 -c "
import json, os, sys
out_dir = '$OUT_DIR'
runs = json.load(open(f'{out_dir}/runs.json'))
failed_ids = [b['id'] for b in runs if b.get('result') in ('failed',)]
seen = set()
for bid in failed_ids:
    tpath = f'{out_dir}/timelines/{bid}.json'
    if not os.path.exists(tpath):
        continue
    try:
        data = json.load(open(tpath))
    except:
        continue
    records = data.get('records', [])
    id_map = {r['id']: r for r in records}
    for r in records:
        if r.get('result') != 'failed' or r.get('type') != 'Task':
            continue
        name = r.get('name', '')
        # Only download logs for test/compile tasks, not post-job cleanup
        keywords = ['test', 'compile', 'hygiene', 'smoke', 'integration', 'sanity', 'unit', 'install dep']
        if not any(kw in name.lower() for kw in keywords):
            continue
        log = r.get('log')
        if not log or not log.get('id'):
            continue
        log_id = log['id']
        key = f'{bid}_{log_id}'
        if key in seen:
            continue
        seen.add(key)
        parent = id_map.get(r.get('parentId', ''), {})
        print(f'{bid},{log_id},{parent.get(\"name\",\"?\")},{name}')
")

LOG_TOTAL=$(echo "$LOG_TARGETS" | grep -c ',' 2>/dev/null || echo "0")
echo "  $LOG_TOTAL failure logs to download"

LOG_COUNT=0
while IFS=',' read -r bid lid job task; do
  [[ -z "$bid" ]] && continue
  outfile="$OUT_DIR/logs/${bid}_${lid}.txt"
  if [[ -f "$outfile" ]]; then
    LOG_COUNT=$((LOG_COUNT + 1))
    continue
  fi
  az devops invoke \
    --area build --resource logs \
    --route-parameters buildId="$bid" logId="$lid" project="$PROJECT" \
    --org "$ORG" --output json 2>/dev/null | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    lines = data.get('value', [])
    # Keep last 100 lines — the error is usually at the tail
    for line in lines[-100:]:
        print(line.rstrip())
except:
    print('PARSE_ERROR: Failed to parse log JSON')
" > "$outfile" 2>/dev/null &
  LOG_COUNT=$((LOG_COUNT + 1))
  if (( LOG_COUNT % BATCH_SIZE == 0 )); then
    wait
    echo "  $LOG_COUNT / $LOG_TOTAL"
  fi
done <<< "$LOG_TARGETS"
wait
echo "  ✓ $LOG_COUNT logs downloaded"

echo
echo "════════════════════════════════════════════════════════════════"
echo "  Data saved to: $OUT_DIR/"
echo "  Now run: node <skill-dir>/scripts/analyze-builds.mjs $OUT_DIR"
echo "════════════════════════════════════════════════════════════════"
