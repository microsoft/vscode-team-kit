// A pull request of the changelog, downloaded into videos/<owner>-<repo>-<n>/: pr.json (its facts and description),
// pr.diff, brief.md (what a chapter needs to know about it) and every file it changes at its head commit (build/src/),
// so a chapter's strings can be checked against the PR, and the rest can run with no network (PRS_OFFLINE).
import fs from 'node:fs';
import path from 'node:path';
import { buildDir, isOffline, parsePrRef, readJson, videoDir, writeJson } from './common.mjs';
import { api, fileAt, paginate, prDiff } from './github.mjs';

export function isTestFile(p) {
	return /(^|\/)(test|tests|__tests__|spec)\//.test(p) || /[._-](test|spec|integrationTest)\.[^/]+$/i.test(p) || /(^|\/)test_[^/]+\.py$/.test(p);
}

export function deriveArea(p) {
	const s = p.split('/');
	if (s[0] === 'src' && s[1] === 'vs') {
		const [, , layer, scope, feature] = s;
		if (layer === 'platform' && scope) {
			return `platform/${scope}`;
		}
		if (layer === 'workbench' && ['services', 'contrib', 'api'].includes(scope) && feature) {
			return `workbench/${scope}/${feature}`;
		}
		if (layer && scope && s.length > 4) {
			return `${layer}/${scope}`;
		}
		return layer ?? p;
	}
	if (s[0] === 'extensions' && s[1]) {
		return `extensions/${s[1]}`;
	}
	return s.length > 2 ? `${s[0]}/${s[1]}` : s.length === 2 ? s[0] : '(root)';
}

/** Parses a unified diff into per-file hunks with old/new line numbers. */
export function parseDiff(diffText) {
	const files = new Map();
	let current = null, hunk = null, oldN = 0, newN = 0;
	for (const line of diffText.split('\n')) {
		if (line.startsWith('diff --git ')) {
			current = null;
			hunk = null;
			continue;
		}
		const plus = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
		if (plus && !hunk) {
			const p = plus[1].trim();
			current = p === '/dev/null' ? null : { path: p, hunks: [], added: new Set(), removed: 0 };
			if (current) {
				files.set(p, current);
			}
			continue;
		}
		if (line.startsWith('--- ') && !hunk) {
			continue;
		}
		const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
		if (h && current) {
			oldN = Number(h[1]);
			newN = Number(h[2]);
			hunk = { header: h[3].trim(), lines: [] };
			current.hunks.push(hunk);
			continue;
		}
		if (!hunk || !current) {
			continue;
		}
		if (line.startsWith('+')) {
			hunk.lines.push({ type: '+', old: null, new: newN, text: line.slice(1) });
			current.added.add(newN++);
		} else if (line.startsWith('-')) {
			hunk.lines.push({ type: '-', old: oldN++, new: null, text: line.slice(1) });
			current.removed++;
		} else if (line.startsWith(' ')) {
			hunk.lines.push({ type: ' ', old: oldN++, new: newN++, text: line.slice(1) });
		} else if (!line.startsWith('\\')) {
			hunk = null;
		}
	}
	return files;
}

const DOTTED = String.raw`[A-Za-z][\w-]*(?:\.[\w-]+)+`;
const SETTING_KEY = new RegExp(String.raw`^\s*(?:(['"])(${DOTTED})\1|\[([A-Za-z_$][\w$.]*)\])\s*:\s*\{\s*$`);
const STRING_CONST = new RegExp(String.raw`\b(?:const|readonly)\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*(['"])(${DOTTED})\2`);
const DEFAULT = /^\s*["']?default["']?\s*:\s*(.+?),?\s*$/;

/** The setting keys the diff shows: 'id': {, or [constant]: { with the constant's string from the diff. */
function settingIds(diffFiles) {
	const ids = new Map();
	for (const [, file] of diffFiles) {
		for (const l of file.hunks.flatMap(h => h.lines)) {
			const m = l.type !== '-' && l.text.match(STRING_CONST);
			if (m) {
				ids.set(m[1], m[3]);
			}
		}
	}
	return ids;
}

/**
 * The settings a PR adds or whose default it changes, outside the tests: { path, id, constant, default, was }, with the
 * default before the PR (`was`) when the diff changes it.
 */
export function settingsFromDiff(diffFiles) {
	const ids = settingIds(diffFiles);
	const out = [];
	for (const [p, file] of diffFiles) {
		if (isTestFile(p)) {
			continue;
		}
		for (const h of file.hunks) {
			let key = null;
			const lines = h.lines;
			lines.forEach((l, i) => {
				const m = l.type !== '-' && l.text.match(SETTING_KEY);
				if (m) {
					key = { id: m[2] ?? ids.get(m[3]?.split('.').pop()) ?? null, constant: m[3] ?? null, added: l.type === '+' };
					return;
				}
				const d = l.type === '+' && key && l.text.match(DEFAULT);
				if (!d) {
					return;
				}
				// The removed default just before (the same key's), when the PR changes it.
				const was = lines.slice(Math.max(0, i - 3), i).reverse().find(x => x.type === '-' && DEFAULT.test(x.text))?.text.match(DEFAULT)[1] ?? null;
				if (key.added || was !== null) {
					out.push({ path: p, id: key.id, constant: key.constant, default: d[1], was, added: key.added });
				}
			});
		}
	}
	return out;
}

export function testsFromDiff(diffFiles) {
	const out = [];
	for (const [p, file] of diffFiles) {
		if (!isTestFile(p)) {
			continue;
		}
		const names = [];
		for (const h of file.hunks) {
			for (const l of h.lines) {
				const m = l.type === '+' && (l.text.match(/\b(?:test|it|suite|describe)\s*\(\s*(['"`])((?:\\.|(?!\1).)+)\1/) ?? l.text.match(/^\s*def\s+(test_\w+)/));
				if (m) {
					names.push(m[2] ?? m[1]);
				}
			}
		}
		if (names.length) {
			out.push({ path: p, names });
		}
	}
	return out;
}

/** "Fixes #123" / "closes owner/repo#123" in the body (GitHub's closing keywords). */
export function closingRefs(body, full) {
	const out = [];
	for (const m of body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+(?:https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/|([\w.-]+\/[\w.-]+)?#)(\d+)/gi)) {
		const repo = m[1] ?? m[2] ?? full;
		if (repo.toLowerCase() === full.toLowerCase() && !out.some(i => i.number === Number(m[3]))) {
			out.push({ number: Number(m[3]), url: `https://github.com/${full}/issues/${m[3]}` });
		}
	}
	return out;
}

/** Accounts that post status or policy notes, not review. */
const NOISE = /^(vs-code-engineering|github-actions|microsoft-github-policy-service|azure-pipelines|codecov|dependabot|vscode-triage-bot)(\[bot\])?$/i;

/** What reviewers and the author said, oldest first and trimmed; status bots left out. It often says what a change does. */
export function reviewDiscussion(reviews = [], reviewComments = [], comments = []) {
	const clean = text => String(text ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/\r/g, '').replace(/<\/?[a-z][^>]*>/gi, ' ')
		.split('\n').filter(line => !/^\s*\|/.test(line)).join('\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
	const items = [
		...reviews.filter(r => clean(r.body)).map(r => ({ at: r.submitted_at, who: r.user?.login, kind: `review (${String(r.state).toLowerCase().replace(/_/g, ' ')})`, body: clean(r.body) })),
		...reviewComments.map(c => ({ at: c.created_at, who: c.user?.login, kind: 'on a line', where: `${c.path}${c.line ?? c.original_line ? `:${c.line ?? c.original_line}` : ''}`, body: clean(c.body) })),
		...comments.map(c => ({ at: c.created_at, who: c.user?.login, kind: 'comment', body: clean(c.body) })),
	].filter(i => i.who && i.body && !NOISE.test(i.who));
	return items.sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(0, 20)
		.map(i => ({ ...i, body: i.body.length > 1200 ? `${i.body.slice(0, 900)} [\u2026] ${i.body.slice(-250)}` : i.body }));
}

export async function fetchPr(ref) {
	const [pr, rawFiles, commits, reviews, diffText, reviewComments, comments] = await Promise.all([
		api(`repos/${ref.full}/pulls/${ref.number}`),
		paginate(`repos/${ref.full}/pulls/${ref.number}/files`),
		paginate(`repos/${ref.full}/pulls/${ref.number}/commits`),
		paginate(`repos/${ref.full}/pulls/${ref.number}/reviews`).catch(() => []),
		prDiff(ref.full, ref.number).catch(() => null),
		paginate(`repos/${ref.full}/pulls/${ref.number}/comments`).catch(() => []),
		paginate(`repos/${ref.full}/issues/${ref.number}/comments`).catch(() => []),
	]);
	const diff = diffText ?? rawFiles.map(f => `diff --git a/${f.filename} b/${f.filename}\n--- a/${f.previous_filename ?? f.filename}\n+++ b/${f.filename}\n${f.patch ?? ''}`).join('\n');
	const files = rawFiles.map(f => ({ path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, area: deriveArea(f.filename), isTest: isTestFile(f.filename) }));
	const facts = {
		repo: ref.full, number: pr.number, url: pr.html_url, title: pr.title, authorLogin: pr.user.login,
		state: pr.merged_at ? 'MERGED' : pr.state.toUpperCase(), mergedAt: pr.merged_at, mergeCommit: pr.merge_commit_sha ?? null,
		baseRef: pr.base.ref, headSha: pr.head.sha, headSha9: pr.head.sha.slice(0, 9),
		additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changed_files, fetchedAt: new Date().toISOString(),
		commits: commits.map(c => ({ sha9: c.sha.slice(0, 9), headline: c.commit.message.split('\n')[0] })),
		files, linkedIssues: closingRefs(pr.body ?? '', ref.full),
	};
	const diffFiles = parseDiff(diff);
	return {
		facts, body: pr.body ?? '', diff, discussion: reviewDiscussion(reviews, reviewComments, comments),
		settings: settingsFromDiff(diffFiles), tests: testsFromDiff(diffFiles),
	};
}

/** Not worth downloading: nobody shows a lock file or a binary in a chapter. */
const NOT_SHOWN = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock)$|\.(png|jpe?g|gif|ico|webp|bmp|woff2?|ttf|otf|eot|mp3|mp4|webm|wav|zip|gz|tgz|vsix|exe|dll|so|dylib|node|wasm|pdf)$/i;

/** Saves every file the PR changes, at its head commit (removed, binary and lock files aside); returns those that failed. */
export async function cacheChangedFiles(slug, facts, { concurrency = 8 } = {}) {
	const at = file => path.join(buildDir(slug), 'src', facts.headSha9, file);
	const todo = facts.files.filter(f => f.status !== 'removed' && !NOT_SHOWN.test(f.path) && !fs.existsSync(at(f.path)));
	const failed = [];
	let next = 0;
	const worker = async () => {
		while (next < todo.length) {
			const file = todo[next++];
			try {
				const text = await fileAt(facts.repo, facts.headSha, file.path);
				fs.mkdirSync(path.dirname(at(file.path)), { recursive: true });
				fs.writeFileSync(at(file.path), text);
			} catch (error) {
				failed.push({ path: file.path, error: String(error.message).split('\n')[0] });
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
	return failed;
}

const signed = (a, d) => `+${a} \u2212${d}`;

/** brief.md of a PR: what a chapter about it needs, and where the rest is. */
export function writeBrief(dir, data) {
	const { facts: f, body, settings, tests, discussion } = data;
	const lines = [`# ${f.repo}#${f.number}: ${f.title}`, ''];
	lines.push(`- by @${f.authorLogin} \u00b7 ${f.state.toLowerCase()}${f.mergedAt ? ` ${f.mergedAt.slice(0, 16).replace('T', ' ')} UTC` : ''} into \`${f.baseRef}\``);
	lines.push(`- ${signed(f.additions, f.deletions)} in ${f.changedFiles} files \u00b7 head ${f.headSha9}${f.mergeCommit ? ` \u00b7 merge ${f.mergeCommit.slice(0, 9)}` : ''}`);
	lines.push(`- ${f.url}`, '');
	lines.push('## The description (verbatim)', '');
	const b = body.trim() || '(empty)';
	lines.push(b.length > 8000 ? `${b.slice(0, 8000)}\n\n[\u2026 ${b.length - 8000} more characters in pr.json]` : b, '');
	if (settings.length) {
		lines.push('## Settings it adds, or whose default it changes', '');
		for (const s of settings) {
			const name = s.id ?? s.constant ?? '(a setting)';
			lines.push(`- \`${name}\` in \`${s.path}\`: ${s.added ? 'new, ' : ''}default ${s.was !== null ? `\`${s.was}\` \u2192 ` : ''}\`${s.default}\``);
		}
		lines.push('');
	}
	if (tests.length) {
		lines.push('## Tests it adds or changes', '', 'They often hold its example values (a path, a label) and what a user sees.', '');
		for (const t of tests) {
			lines.push(`- \`${t.path}\`: ${t.names.slice(0, 12).map(n => `"${n}"`).join(', ')}${t.names.length > 12 ? ` (+${t.names.length - 12} more)` : ''}`);
		}
		lines.push('');
	}
	if (discussion.length) {
		lines.push('## Review discussion (oldest first, trimmed)', '');
		for (const d of discussion) {
			lines.push(`- **@${d.who}**, ${d.kind}${d.where ? ` on \`${d.where}\`` : ''}: ${d.body.replace(/\n+/g, ' ')}`);
		}
		lines.push('');
	}
	lines.push('## Files', '');
	for (const file of [...f.files].sort((x, y) => (y.additions + y.deletions) - (x.additions + x.deletions))) {
		lines.push(`- \`${file.path}\` ${signed(file.additions, file.deletions)}${file.isTest ? ' (test)' : ''}${file.status !== 'modified' ? ` (${file.status})` : ''}`);
	}
	lines.push('', '## Next', '');
	lines.push(`Read \`pr.diff\` next to this file (search it for the UI strings: \`localize(\`, \`nls.localize(\`, \`title:\`, \`description\`), and the changed files at the head commit in \`build/src/${f.headSha9}/\`. Every string a chapter shows must be in them.`);
	fs.writeFileSync(path.join(dir, 'brief.md'), `${lines.join('\n')}\n`);
}

/**
 * Downloads a PR of the changelog (its folder is reused when it is there: another day's report may name it again).
 * Offline (PRS_OFFLINE), only what was downloaded before the run.
 */
export async function downloadPr(url) {
	const ref = parsePrRef(url);
	const dir = videoDir(ref.slug);
	const done = path.join(dir, 'pr.json');
	if (fs.existsSync(done)) {
		return { ref, data: readJson(done) };
	}
	if (isOffline()) {
		throw new Error(`Offline (PRS_OFFLINE): ${ref.full}#${ref.number} was not downloaded before this run`);
	}
	fs.mkdirSync(dir, { recursive: true });
	const data = await fetchPr(ref);
	fs.writeFileSync(path.join(dir, 'pr.diff'), data.diff);
	writeBrief(dir, data);
	const failed = await cacheChangedFiles(ref.slug, data.facts);
	if (failed.length) {
		console.log(`  ${ref.full}#${ref.number}: ${failed.length} changed file(s) couldn't be downloaded (${failed.map(x => x.path).join(', ')})`);
	}
	// Last: the folder counts as complete once pr.json is there.
	writeJson(done, { facts: data.facts, body: data.body, discussion: data.discussion, settings: data.settings, tests: data.tests });
	return { ref, data: readJson(done) };
}
