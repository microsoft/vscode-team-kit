"""The facts a test video needs about an item, in one command: what it is, the PRs that fixed or built it, whether the
installed Insiders (or --build) has them, and the title's "Insiders from … or newer" phrase.

    $PY item.py <issue number or URL> [--repo microsoft/vscode] [--build <path to the .app>]
    $PY item.py --commit <sha>      the first Insiders build with a commit, and the title's phrase (for a group of bugs,
                                    run it on the newest fix's merge commit)

For a TPI, the PRs come from the issues and PRs its body refers to (an issue's closing or linked PRs, one level deep);
for a bug or a feature request, from its timeline: the PR or commit that closed it, and merged PRs that refer to it.
Reads GitHub with `gh` (signed in). Check the list: a referenced PR can be unrelated.
"""
import json
import re
import subprocess
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

sys.dont_write_bytecode = True


def gh(*command):
	result = subprocess.run(['gh', *command], capture_output=True, text=True)
	if result.returncode:
		raise SystemExit(f'gh {" ".join(command[:3])}…: {result.stderr.strip()[:300]}')
	return result.stdout


def first_build(target):
	"""The oldest Insiders build (macOS arm64) with `target`, the newest without it, and the title's phrase: when an
	earlier build from the same day lacks the commit, the phrase names the build ("Insiders from Oct 16 (0b37947e9c)")."""
	builds = json.load(urllib.request.urlopen('https://update.code.visualstudio.com/api/commits/insider/darwin-arm64'))  # newest first
	contains = lambda b: subprocess.run(['gh', 'api', f'repos/microsoft/vscode/compare/{target}...{b}', '--jq', '.status'], capture_output=True, text=True).stdout.strip() in ('ahead', 'identical')
	date = lambda sha: gh('api', f'repos/microsoft/vscode/commits/{sha}', '--jq', '.commit.committer.date').strip()
	if not contains(builds[0]):
		return [f'No Insiders build contains {target} yet (newest: {builds[0][:10]}).']
	lo, hi = 0, len(builds) - 1
	if contains(builds[hi]):
		return [f'Every listed build contains {target}: it is older than {builds[hi][:10]} ({date(builds[hi])}).']
	while hi - lo > 1:
		mid = (lo + hi) // 2
		lo, hi = (mid, hi) if contains(builds[mid]) else (lo, mid)
	first, before = builds[lo], builds[hi]
	when, earlier = (datetime.fromisoformat(date(b).replace('Z', '+00:00')) for b in (first, before))
	same_day = earlier.date() == when.date()
	return [f'first Insiders build with {target[:10]}: {first[:10]} ({when:%Y-%m-%d %H:%M} UTC); the one before, without it: {before[:10]} ({earlier:%Y-%m-%d %H:%M} UTC)',
		f'title: Insiders from {when:%b} {when.day}{f" ({first[:10]})" if same_day else ""} or newer']


args = sys.argv[1:]
if not args:
	raise SystemExit(__doc__)
if args[0] == '--commit':
	print('\n'.join(first_build(args[1])))
	sys.exit(0)
opt = lambda name, default=None: args[args.index(name) + 1] if name in args else default
repo = opt('--repo', 'microsoft/vscode')
app = Path(opt('--build', '/Applications/Visual Studio Code - Insiders.app'))
ref = args[0]
match = re.search(r'github\.com/([^/]+/[^/]+)/(?:issues|pull)/(\d+)', ref)
if match:
	repo, number = match.group(1), int(match.group(2))
else:
	number = int(ref.lstrip('#').split('#')[-1])
owner, name = repo.split('/')


def graphql(query):
	return json.loads(gh('api', 'graphql', '-f', f'query={query}'))['data']['repository']


PR_FIELDS = 'number title state mergedAt mergeCommit { oid } url repository { nameWithOwner }'
LINKS = f'''timelineItems(itemTypes: [CLOSED_EVENT, CROSS_REFERENCED_EVENT, CONNECTED_EVENT], last: 40) {{ nodes {{ __typename
	... on ClosedEvent {{ closer {{ __typename ... on PullRequest {{ {PR_FIELDS} }} ... on Commit {{ oid committedDate repository {{ nameWithOwner }} }} }} }}
	... on CrossReferencedEvent {{ source {{ __typename ... on PullRequest {{ {PR_FIELDS} }} }} }}
	... on ConnectedEvent {{ subject {{ __typename ... on PullRequest {{ {PR_FIELDS} }} }} }} }} }}'''


def linked(n):
	"""The PRs and commits an issue's timeline links: closers first, then merged PRs that refer to it."""
	data = graphql(f'{{ repository(owner: "{owner}", name: "{name}") {{ issueOrPullRequest(number: {n}) {{ __typename ... on Issue {{ {LINKS} }} ... on PullRequest {{ {PR_FIELDS} }} }} }} }}')['issueOrPullRequest']
	if data['__typename'] == 'PullRequest':
		return [('this PR', data)]
	closers, refs = [], []
	for node in data['timelineItems']['nodes']:
		target = node.get('closer') or node.get('source') or node.get('subject')
		if not target or target.get('__typename') not in ('PullRequest', 'Commit'):
			continue
		(closers if node['__typename'] == 'ClosedEvent' else refs).append(('closed it' if node['__typename'] == 'ClosedEvent' else 'refers to it', target))
	# A closing PR usually also refers to the issue earlier in the timeline: list it once, as the closer.
	return closers + refs


issue = json.loads(gh('issue', 'view', str(number), '--repo', repo, '--json', 'number,title,state,stateReason,labels,milestone,body,author,assignees'))
labels = [label['name'] for label in issue['labels']]
kind = 'TPI' if 'testplan-item' in labels else 'issue'
print(f'#{number} ({kind}, {issue["state"].lower()}{", reopened" if issue.get("stateReason") == "REOPENED" else ""}): {issue["title"]}')
print(f'  labels: {", ".join(labels) or "none"}; milestone: {(issue.get("milestone") or {}).get("title", "none")}; author: {issue["author"]["login"]}; assignees: {", ".join(a["login"] for a in issue["assignees"]) or "none"}')
if kind == 'TPI':
	boxes = re.findall(r'- \[[ x]\] (\S+)(?: @(\S+))?', issue['body'] or '')
	if boxes:
		print('  testers: ' + ', '.join(f'{who or "?"} ({os})' for os, who in boxes))

candidates = []
if kind == 'TPI':
	refs = []
	for found in re.findall(r'(?:github\.com/microsoft/vscode/(?:issues|pull)/|(?<![\w/])#)(\d{5,6})\b', issue['body'] or ''):
		if int(found) != number and int(found) not in refs:
			refs.append(int(found))
	for r in refs[:8]:
		candidates += [(f'via #{r}: {why}', target) for why, target in linked(r)]
else:
	candidates = linked(number)

product = json.loads((app / 'Contents/Resources/app/product.json').read_text()) if (app / 'Contents/Resources/app/product.json').exists() else None
build = product['commit'] if product else None
print(f'  build: {product["version"]} {build[:10]} ({app.name})' if product else f'  build: none found at {app}')

def compare(sha):
	result = subprocess.run(['gh', 'api', f'repos/{repo}/compare/{sha}...{build}', '--jq', '.status'], capture_output=True, text=True)
	status = result.stdout.strip() if result.returncode == 0 else 'unknown'
	return {'ahead': 'in the build', 'identical': 'in the build', 'behind': 'NOT in the build', 'diverged': 'NOT in the build'}.get(status, f'build check: {status}')


seen, merged = set(), []
for why, target in candidates:
	if target['__typename'] == 'Commit':
		key, sha, label, state = target['oid'], target['oid'], f'commit {target["oid"][:10]}', 'committed'
	else:
		key, sha, label, state = target['number'], (target.get('mergeCommit') or {}).get('oid'), f'PR #{target["number"]} {target["title"][:70]}', target['state'].lower()
	if key in seen:
		continue
	seen.add(key)
	status = ''
	elsewhere = (target.get('repository') or {}).get('nameWithOwner', repo)
	if elsewhere.lower() != repo.lower():
		label, sha = f'{elsewhere}#{target.get("number", "")} {target.get("title", "")[:60]}'.replace('# ', ' '), None
		status = 'another repository, not checked'
	if sha and build:
		status = compare(sha)
		merged.append((why.endswith('closed it'), target.get('mergedAt') or target.get('committedDate') or '', sha, label))
	print(f'  {label} [{state}{", " + status if status else ""}] ({why})')
if not candidates:
	print('  no linked PR or commit found: read the item and its comments for the change')

if merged:
	# The title follows the newest change that closed the item; without one, the newest linked change (check it's the fix).
	closers = [m for m in merged if m[0]]
	_, _, newest, label = max(closers or merged, key=lambda m: m[1])
	print(f'  title from {label}{"" if closers else " (no closing PR: check this is the fix)"}:')
	print('  ' + '\n  '.join(first_build(newest)))
