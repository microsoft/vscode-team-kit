#!/usr/bin/env bash
# The daily changelog video on this machine, as the daily job makes it: the setup, `prs digest new` (the report, its
# PRs, and the VS Code build that has the picks), then an agent nobody watches (the GitHub Copilot CLI) with the
# skill's prompt.md and the job's tools. For trying changes to the skill or the engine before the job gets them.
#
#   changelog-videos/scripts/unattended.sh [--run <report run id> | --date YYYY-MM-DD | --file report.md]
#                                          [--model claude-opus-5.5] [--credits 1500]
#
# Needs: the copilot CLI, and gh signed in to an account that can read the changelog report (or --file). The agent's
# log and its session go to the project's build/agent/.
set -euo pipefail
plugin="$(cd "$(dirname "$0")/.." && pwd)"

source=()
model="claude-opus-5.5"
credits="1500"
while [ $# -gt 0 ]; do
	case "$1" in
		--run|--date|--file) source=("$1" "$2"); shift 2 ;;
		--model) model="$2"; shift 2 ;;
		--credits) credits="$2"; shift 2 ;;
		*) echo "usage: unattended.sh [--run <id> | --date YYYY-MM-DD | --file report.md] [--model <model>] [--credits <n>]" >&2; exit 2 ;;
	esac
done

engine=$(node "$plugin/scripts/setup.mjs" | sed -n 's/^ENGINE=//p' | tail -n 1)
if [ -z "$engine" ]; then
	echo "the setup didn't print ENGINE=" >&2
	exit 1
fi
setup=$(node "$engine/cli/prs.mjs" digest new ${source[@]+"${source[@]}"})
echo "$setup"
slug=$(printf '%s\n' "$setup" | sed -n 's#^videos/\(changelog-[0-9-]*\):.*#\1#p' | head -n 1)
if [ -z "$slug" ]; then
	echo "prs digest new didn't make a project" >&2
	exit 1
fi

# The prompt: the text block of the skill's prompt.md, for this project.
prompt=$(awk '/^```text$/ { inside = 1; next } /^```$/ { inside = 0 } inside' "$plugin/skills/generate-changelog-video/prompt.md" \
	| sed -e "s#<plugin>#$plugin#g" -e "s#<engine>#$engine#g" -e "s#<slug>#$slug#g")
out="$engine/videos/$slug/build/agent"
mkdir -p "$out"

# The job's tools: these commands in the shell, and file edits. Nothing else (no git, no network tools).
tools=()
for c in cd node python3 cat ls grep head tail sed awk cut tr wc sort uniq find echo printf jq mkdir cp mv rm sleep ps pgrep date test; do
	tools+=(--allow-tool "shell($c)")
done

# The agent works in the engine; it reads the skill, and writes in the home (the engine's videos/ is a link into it).
home="$(cd "$engine/../.." && pwd)"
start=$(date +%s)
cd "$engine"
copilot -p "$prompt" --model "$model" --no-ask-user --disable-builtin-mcps --add-dir "$home" --add-dir "$plugin" \
	"${tools[@]}" --allow-tool write --max-ai-credits "$credits" \
	--log-dir "$out/logs" --share "$out/session.md" 2>&1 | tee "$out/agent.log"
echo "agent: $(( ($(date +%s) - start) / 60 )) min, model $model; its session: $out/session.md"
