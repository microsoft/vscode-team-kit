"""The first VS Code Insiders build (macOS arm64) that contains a commit, and the date to put in a video's title.

    $PY firstbuild.py <commit sha, e.g. a PR's merge commit>

Prints the oldest Insiders build containing the commit, the newest without it, and a title phrase
("Insiders from Oct 16 or newer"; "Insiders from Oct 16 (0b37947e9c) or newer" when an earlier build from the same
day lacks the commit). Uses the update service's list of builds and `gh api .../compare`.
"""
import json
import subprocess
import sys
import urllib.request
from datetime import datetime

target = sys.argv[1]
builds = json.load(urllib.request.urlopen('https://update.code.visualstudio.com/api/commits/insider/darwin-arm64'))  # newest first


def contains(build):
	status = subprocess.run(['gh', 'api', f'repos/microsoft/vscode/compare/{target}...{build}', '--jq', '.status'], capture_output=True, text=True).stdout.strip()
	return status in ('ahead', 'identical')


def date(sha):
	return subprocess.run(['gh', 'api', f'repos/microsoft/vscode/commits/{sha}', '--jq', '.commit.committer.date'], capture_output=True, text=True, check=True).stdout.strip()


if not contains(builds[0]):
	raise SystemExit(f'No Insiders build contains {target} yet (newest: {builds[0][:10]}).')
# Builds are in history order: binary search for the oldest one containing the commit.
lo, hi = 0, len(builds) - 1
if contains(builds[hi]):
	raise SystemExit(f'Every listed build contains {target}: it is older than {builds[hi][:10]} ({date(builds[hi])}).')
while hi - lo > 1:
	mid = (lo + hi) // 2
	if contains(builds[mid]):
		lo = mid
	else:
		hi = mid
first, before = builds[lo], builds[hi]
when = datetime.fromisoformat(date(first).replace('Z', '+00:00'))
earlier = datetime.fromisoformat(date(before).replace('Z', '+00:00'))
print(f'first Insiders build with {target[:10]}: {first[:10]} ({when:%Y-%m-%d %H:%M} UTC); the one before, without it: {before[:10]} ({earlier:%Y-%m-%d %H:%M} UTC)')
# When a build from the same day lacks the commit, the date alone is ambiguous: name the build too.
same_day = earlier.date() == when.date()
print(f'title: Insiders from {when:%b} {when.day}{f" ({first[:10]})" if same_day else ""} or newer')
