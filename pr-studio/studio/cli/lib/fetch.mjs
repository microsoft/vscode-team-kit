// prs new: fetch a pull request (any repo) into videos/<slug>/: pr.json, pr.diff, brief.md and a storyboard skeleton.
import fs from 'node:fs';
import path from 'node:path';
import { CAP, isOffline, parsePrRef, readJson, videoDir, writeJson } from './common.mjs';
import { cacheChangedFiles, parseDiff } from './code.mjs';
import { api, graphql, paginate, prDiff } from './github.mjs';

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

const DECL = [
	/\b(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
	/\b(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/,
	/\b(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/,
	/\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*=/,
	/\b(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
	/^\s*(?:(?:public|private|protected|static|readonly|override|abstract|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)?\s*(?::\s*[^={]+)?\{?\s*$/,
	/\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/,
	/^\s*def\s+([A-Za-z_]\w*)/, /^\s*class\s+([A-Za-z_]\w*)/,
	/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, /^\s*(?:pub\s+)?fn\s+([A-Za-z_]\w*)/,
];
const NOT_NAMES = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'constructor', 'super', 'await', 'new', 'else', 'do', 'try']);

function declName(line) {
	for (const re of DECL) {
		const m = line.match(re);
		if (m && !NOT_NAMES.has(m[1])) {
			return m[1];
		}
	}
	return null;
}

export function symbolsFromDiff(diffFiles) {
	const out = [];
	for (const [p, file] of diffFiles) {
		const added = new Set(), removed = new Set(), within = new Set();
		for (const h of file.hunks) {
			const ctxName = declName(h.header) ?? (h.header.match(/([A-Za-z_$][\w$]*)\s*\(/)?.[1]);
			if (ctxName && !NOT_NAMES.has(ctxName)) {
				within.add(ctxName);
			}
			for (const l of h.lines) {
				const n = l.type !== ' ' ? declName(l.text) : null;
				if (n) {
					(l.type === '+' ? added : removed).add(n);
				}
			}
		}
		const both = [...added].filter(n => removed.has(n));
		out.push({
			path: p,
			added: [...added].filter(n => !removed.has(n)),
			removed: [...removed].filter(n => !added.has(n)),
			changed: [...new Set([...both, ...[...within].filter(n => !added.has(n) && !removed.has(n))])],
		});
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
				if (l.type !== '+') {
					continue;
				}
				const m = l.text.match(/\b(?:test|it|suite|describe)\s*\(\s*(['"`])((?:\\.|(?!\1).)+)\1/) ?? l.text.match(/^\s*def\s+(test_\w+)/);
				if (m) {
					names.push(m[2] ?? m[1]);
				}
			}
		}
		out.push({ path: p, names });
	}
	return out;
}

/** The description without the sections that say how it was checked (validation, tests, screenshots, follow-ups):
 * words there ("authenticated", "token") describe the testing, not what the change touches. */
export function describingText(body = '') {
	return body.split(/^(?=#{1,6}\s)/m)
		.filter(section => !/^#{1,6}\s*(validation|verification|testing|tests?|how to test|manual (checks?|testing)|screenshots?|known follow-?ups?|follow-?ups?)\b/i.test(section))
		.join('');
}

export function lengthTier(facts, body = '') {
	const nonTest = facts.files.filter(f => !f.isTest).reduce((a, f) => a + f.additions + f.deletions, 0);
	const areas = facts.areas.length;
	let tier = nonTest <= 150 && areas <= 2 ? 0 : nonTest <= 600 && areas <= 4 ? 1 : 2;
	const reasons = [`${nonTest} changed lines outside tests`, `${areas} area${areas === 1 ? '' : 's'}`];
	const sensitive = `${facts.title}\n${describingText(body)}`.match(/\b(security|auth|authenticat\w*|authoriz\w*|oauth|credentials?|protocol|ipc|breaking|permissions?|sandbox(ing)?|encrypt\w*)\b/i);
	if (tier < 2 && sensitive) {
		tier++;
		reasons.push(`touches security, protocols or compatibility (it says "${sensitive[0]}")`);
	}
	// How many ideas the PR likely holds, for the skeleton's beats: a starting point, not a length. The length is a cap
	// (CAP): as short as covering the six answers allows.
	return { name: ['small', 'medium', 'large'][tier], beats: [4, 5, 6][tier], reasons };
}

/** Review state the way GitHub summarizes it, from the reviews themselves (GraphQL gives it directly when we have a token). */
function reviewDecisionFrom(reviews, author, open) {
	const latest = new Map();
	for (const r of reviews) {
		if (r.user?.login && r.user.login !== author && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)) {
			latest.set(r.user.login, r.state);
		}
	}
	const states = [...latest.values()];
	return states.includes('CHANGES_REQUESTED') ? 'CHANGES_REQUESTED' : states.includes('APPROVED') ? 'APPROVED' : open ? 'REVIEW_REQUIRED' : null;
}

/** "Fixes #123" / "closes owner/repo#123" in the body (GitHub's closing keywords), when GraphQL isn't available. */
export function closingRefs(body, full) {
	const out = [];
	for (const m of body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+(?:https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/|([\w.-]+\/[\w.-]+)?#)(\d+)/gi)) {
		const repo = m[1] ?? m[2] ?? full;
		if (repo.toLowerCase() === full.toLowerCase() && !out.some(i => i.number === Number(m[3]))) {
			out.push({ number: Number(m[3]), title: '', url: `https://github.com/${full}/issues/${m[3]}` });
		}
	}
	return out;
}

/** The PR's numbers and lists from REST (a token helps but isn't required). */
export async function fetchPrMeta(ref) {
	const [pr, rawFiles] = await Promise.all([
		api(`repos/${ref.full}/pulls/${ref.number}`),
		paginate(`repos/${ref.full}/pulls/${ref.number}/files`),
	]);
	return { pr, rawFiles };
}

export function summarizeFiles(rawFiles) {
	const files = rawFiles.map(f => ({ path: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, area: deriveArea(f.filename), isTest: isTestFile(f.filename) }));
	const areasMap = new Map();
	for (const f of files) {
		const a = areasMap.get(f.area) ?? { name: f.area, files: 0, additions: 0, deletions: 0 };
		a.files++;
		a.additions += f.additions;
		a.deletions += f.deletions;
		areasMap.set(f.area, a);
	}
	return { files, areas: [...areasMap.values()].sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions)) };
}

export async function fetchPr(ref) {
	const { pr, rawFiles } = await fetchPrMeta(ref);
	const [commits, reviews, diffText, extra, reviewComments, comments, authorUser] = await Promise.all([
		paginate(`repos/${ref.full}/pulls/${ref.number}/commits`),
		paginate(`repos/${ref.full}/pulls/${ref.number}/reviews`),
		prDiff(ref.full, ref.number).catch(() => null),
		graphql('query($o:String!,$n:String!,$p:Int!){repository(owner:$o,name:$n){pullRequest(number:$p){reviewDecision closingIssuesReferences(first:10){nodes{number title url}}}}}', { o: ref.owner, n: ref.repo, p: ref.number }),
		paginate(`repos/${ref.full}/pulls/${ref.number}/comments`).catch(() => []),
		paginate(`repos/${ref.full}/issues/${ref.number}/comments`).catch(() => []),
		api(`users/${pr.user.login}`).catch(() => null),
	]);
	const diff = diffText ?? rawFiles.map(f => `diff --git a/${f.filename} b/${f.filename}\n--- a/${f.previous_filename ?? f.filename}\n+++ b/${f.filename}\n${f.patch ?? ''}`).join('\n');
	const latest = await api(`repos/${ref.full}/pulls/${ref.number}`);
	if (latest.head.sha !== pr.head.sha) {
		throw new Error('The PR got new commits while fetching; run prs new again');
	}
	const { files, areas } = summarizeFiles(rawFiles);
	const authorName = authorUser?.name && authorUser.name !== pr.user.login ? authorUser.name : null;
	const discussion = reviewDiscussion(reviews, reviewComments, comments);
	const author = pr.user.login;
	const remote = extra?.repository?.pullRequest;
	const state = pr.merged_at ? 'MERGED' : pr.state.toUpperCase();
	const facts = {
		repo: ref.full, number: pr.number, url: pr.html_url, title: pr.title, authorLogin: author, authorName, state, isDraft: !!pr.draft,
		createdAt: pr.created_at, updatedAt: pr.updated_at, mergedAt: pr.merged_at, baseRef: pr.base.ref, headRef: pr.head.ref,
		baseSha: pr.base.sha, headSha: pr.head.sha, headSha9: pr.head.sha.slice(0, 9),
		additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changed_files, commitCount: commits.length,
		reviewDecision: remote ? (remote.reviewDecision || null) : reviewDecisionFrom(reviews, author, state === 'OPEN'),
		labels: pr.labels.map(l => l.name), fetchedAt: new Date().toISOString(),
		commits: commits.map(c => {
			const [headline, ...rest] = c.commit.message.split('\n');
			return { sha9: c.sha.slice(0, 9), headline, message: `${headline}\n${rest.join('\n').replace(/^\n+/, '')}`.trim() };
		}),
		files, areas,
		testFiles: files.filter(f => f.isTest).length,
		linkedIssues: remote
			? (remote.closingIssuesReferences?.nodes ?? []).map(i => ({ number: i.number, title: i.title ?? '', url: i.url }))
			: closingRefs(pr.body ?? '', ref.full),
		reviewers: [...new Set(reviews.filter(r => r.user?.login && r.user.login !== author).map(r => r.user.login))],
		approvers: approversOf(reviews),
		reviewCount: reviews.length,
		discussionCount: discussion.length,
	};
	const diffFiles = parseDiff(diff);
	const pictures = prPictures(pr.body ?? '', comments, reviewComments);
	return { facts, body: pr.body ?? '', diff, discussion, pictures, symbols: symbolsFromDiff(diffFiles), tests: testsFromDiff(diffFiles), tier: lengthTier(facts, pr.body ?? '') };
}

/** Accounts that post status or policy notes, not review. */
const NOISE = /^(vs-code-engineering|github-actions|microsoft-github-policy-service|azure-pipelines|codecov|dependabot|vscode-triage-bot)(\[bot\])?$/i;

/** What reviewers and the author said, oldest first: review summaries, comments on lines, and the conversation.
 * Trimmed, so the brief stays readable; status bots are left out. */
export function reviewDiscussion(reviews = [], reviewComments = [], comments = []) {
	// Plain text: no HTML comments or tags (review bots wrap their summaries in <details>), no tables.
	const clean = text => String(text ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/\r/g, '').replace(/<\/?[a-z][^>]*>/gi, ' ')
		.split('\n').filter(line => !/^\s*\|/.test(line)).join('\n').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
	const items = [
		...reviews.filter(r => clean(r.body)).map(r => ({ at: r.submitted_at, who: r.user?.login, kind: `review (${String(r.state).toLowerCase().replace(/_/g, ' ')})`, body: clean(r.body) })),
		...reviewComments.map(c => ({ at: c.created_at, who: c.user?.login, kind: 'on a line', where: `${c.path}${c.line ?? c.original_line ? `:${c.line ?? c.original_line}` : ''}`, body: clean(c.body) })),
		...comments.map(c => ({ at: c.created_at, who: c.user?.login, kind: 'comment', body: clean(c.body) })),
	].filter(i => i.who && i.body && !NOISE.test(i.who));
	// Long ones keep their start and their end: a reply often ends with what matters ("authored by Copilot", a follow-up).
	return items.sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(0, 30)
		.map(i => ({ ...i, body: i.body.length > 1500 ? `${i.body.slice(0, 1150)} [\u2026] ${i.body.slice(-300)}` : i.body }));
}

const IMAGE = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)|<img[^>]+src="(https?:\/\/[^"]+)"/g;

/** The pictures of a PR: the author's (in the description), the before and after pairs of the CI screenshot report
 * (a comment by a bot), and pictures people posted in comments. */
export function prPictures(body = '', comments = [], reviewComments = []) {
	const out = [...String(body).matchAll(IMAGE)].map(m => ({ source: 'description', alt: m[1] ?? '', url: m[2] ?? m[3] }));
	for (const c of [...comments, ...reviewComments]) {
		const text = String(c.body ?? '');
		if (/screenshot-diff-report|##\s*Screenshot Changes/i.test(text)) {
			for (const block of text.split(/<details/i).slice(1)) {
				const name = block.match(/<code>([^<]+)<\/code>/)?.[1] ?? '';
				const before = block.match(/!\[before\]\((https?:\/\/[^)\s]+)\)/i)?.[1];
				const after = block.match(/!\[after\]\((https?:\/\/[^)\s]+)\)/i)?.[1];
				if (before || after) {
					out.push({ source: 'ci', name, before: before ?? null, after: after ?? null });
				}
			}
		} else if (c.user?.login && !NOISE.test(c.user.login)) {
			for (const m of text.matchAll(IMAGE)) {
				out.push({ source: 'comment', who: c.user.login, alt: m[1] ?? '', url: m[2] ?? m[3] });
			}
		}
	}
	return out;
}

/** Logins whose latest decisive review approves (a later comment-only review doesn't take an approval back). */
export function approversOf(reviews = []) {
	const last = new Map();
	for (const r of reviews) {
		if (r.user?.login && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state)) {
			last.set(r.user.login, r.state);
		}
	}
	return [...last].filter(([, state]) => state === 'APPROVED').map(([login]) => login);
}

const signed = (a, d) => `+${a} \u2212${d}`;
const date = iso => new Date(iso).toISOString().slice(0, 10);

export function writeBrief(dir, data) {
	const { facts: f, body, symbols, tests, tier } = data;
	const lines = [];
	lines.push(`# PR brief: ${f.repo}#${f.number}`, '');
	lines.push(`**${f.title}**`, '');
	const decision = f.reviewDecision === 'APPROVED' && f.approvers?.length ? `approved by ${f.approvers.map(r => `@${r}`).join(', ')}` : f.reviewDecision?.toLowerCase().replace(/_/g, ' ');
	lines.push(`- by @${f.authorLogin}${f.authorName ? ` (${f.authorName})` : ''} \u00b7 ${f.isDraft ? 'draft' : f.state.toLowerCase()}${f.reviewers.length ? ` \u00b7 reviewed by ${f.reviewers.map(r => /^copilot/i.test(r) ? 'Copilot (its code review)' : `@${r}`).join(', ')}` : ''}${decision ? ` \u00b7 ${decision}` : ''}`);
	lines.push(`- ${signed(f.additions, f.deletions)} in ${f.changedFiles} files (${f.testFiles} test files) \u00b7 ${f.commitCount} commits \u00b7 head ${f.headSha9} \u00b7 opened ${date(f.createdAt)} \u00b7 fetched ${date(f.fetchedAt)}`);
	lines.push(`- ${f.url}`, '');
	lines.push('## Length', '');
	lines.push(`**${tier.name}** (${tier.reasons.join(', ')}).`, '');
	lines.push('As short as covering the six answers allows (what changes, why, how it works, what it looks like or does, what could break and how it is tested, the status and where to start reading). No minimum.', '');
	lines.push(`- A video: at most **${CAP.fileSeconds} s** with the end card (the last word by ${CAP.seconds} s, about ${CAP.words} words at most). The skeleton has ${tier.beats} beats: the title and status beats say one sentence each; merge or drop the beats that add no answer.`);
	lines.push(`- A deck: at most **${CAP.slides} slides**, the title and status included; no end slide.`);
	if (tier.reasons.some(r => r.startsWith('touches security'))) {
		lines.push('- One size up for that word, so one beat more. If the PR changes no behaviour there (a refactor, or the word is about its tests), drop that beat: say so in your summary.');
	}
	lines.push('');
	lines.push('## What the author says (PR body, verbatim)', '');
	const b = body.trim() || '(empty)';
	lines.push(b.length > 9000 ? `${b.slice(0, 9000)}\n\n[\u2026 ${b.length - 9000} more characters in pr.json]` : b, '');
	const pictures = data.pictures ?? prPictures(body);
	if (!pictures.length) {
		lines.push('## Pictures', '', 'None: no screenshots in the description or the comments, and no CI screenshot report. Draw what needs a picture.', '');
	} else {
		lines.push('## Pictures', '');
		lines.push('Evidence of what the change looks like, for a deck (a video can\'t show pictures). Download the ones you show (`curl -fsSL -o <file> \'<url>\'`) and open them first.', '');
		const own = pictures.filter(x => x.source === 'description'), ci = pictures.filter(x => x.source === 'ci'), said = pictures.filter(x => x.source === 'comment');
		if (own.length) {
			lines.push('In the description (the author\'s):', '', ...own.map(x => `- ${x.alt ? `${x.alt}: ` : ''}${x.url}`), '');
		}
		if (ci.length) {
			lines.push(`Before and after, from the CI screenshot report (a comment on the PR; ${ci.length} screen${ci.length === 1 ? '' : 's'}, PNG; it can list screens the PR didn't mean to change, so check each against the diff; \`prs deck grid <slug> before.png --vs after.png\` shows where a pair differs):`, '');
			lines.push(...ci.slice(0, 10).map(x => `- ${x.name ? `\`${x.name}\`: ` : ''}before ${x.before ?? '(new)'} \u00b7 after ${x.after ?? '(removed)'}`), '');
		}
		if (said.length) {
			lines.push('In comments:', '', ...said.slice(0, 10).map(x => `- @${x.who}${x.alt ? `, ${x.alt}` : ''}: ${x.url}`), '');
		}
	}
	lines.push('## Commits', '');
	for (const c of f.commits) {
		lines.push(`- \`${c.sha9}\` ${c.headline}`);
	}
	const talk = data.discussion ?? [];
	if (!talk.length) {
		lines.push('', '## Review discussion', '', 'None: no review comments, no comments on lines, and no conversation (approvals without a word don\'t show here).');
	} else {
		lines.push('', '## Review discussion', '');
		lines.push('What reviewers and the author said (oldest first, trimmed). It often explains why the code is the way it is; cite it as "in review".', '');
		for (const d of talk) {
			const who = /^copilot/i.test(d.who) ? 'Copilot (code review)' : `@${d.who}`;
			lines.push(`- **${who}**, ${d.kind}${d.where ? ` on \`${d.where}\`` : ''}: ${d.body.replace(/\n+/g, ' ')}`);
		}
	}
	lines.push('', '## Files by area', '');
	for (const a of f.areas) {
		lines.push(`- **${a.name}** (${signed(a.additions, a.deletions)})`);
		for (const file of f.files.filter(x => x.area === a.name).sort((x, y) => (y.additions + y.deletions) - (x.additions + x.deletions))) {
			lines.push(`  - \`${file.path}\` ${signed(file.additions, file.deletions)}${file.isTest ? ' (test)' : ''}${file.status !== 'modified' ? ` (${file.status})` : ''}`);
		}
	}
	lines.push('', '## Symbols touched (from the diff)', '');
	// Up to 30 names a list, and the count of any left out, so a reader knows the list is not the whole file.
	const names = list => `${list.slice(0, 30).map(n => `\`${n}\``).join(', ')}${list.length > 30 ? ` and ${list.length - 30} more` : ''}`;
	for (const s of symbols) {
		const parts = [];
		if (s.added.length) {
			parts.push(`added ${names(s.added)}`);
		}
		if (s.removed.length) {
			parts.push(`removed ${names(s.removed)}`);
		}
		if (s.changed.length) {
			parts.push(`edited in ${names(s.changed)}`);
		}
		if (parts.length) {
			lines.push(`- \`${s.path}\`: ${parts.join('; ')}`);
		}
	}
	if (tests.some(t => t.names.length)) {
		lines.push('', '## Tests added or changed', '');
		for (const t of tests.filter(x => x.names.length)) {
			lines.push(`- \`${t.path}\`: ${t.names.slice(0, 15).map(n => `"${n}"`).join(', ')}${t.names.length > 15 ? ` (+${t.names.length - 15} more)` : ''}`);
		}
	}
	if (f.linkedIssues.length) {
		lines.push('', '## Linked issues', '');
		for (const i of f.linkedIssues) {
			lines.push(`- #${i.number} ${i.title}`);
		}
	}
	lines.push('', '## Next', '');
	const nonTest = f.files.filter(x => !x.isTest).reduce((a, x) => a + x.additions + x.deletions, 0);
	lines.push(nonTest <= 400
		? `Read \`pr.diff\` next to this file, all of it outside the tests (${nonTest} lines): small enough to know every change. Then:`
		: `Read \`pr.diff\` next to this file where it matters (${nonTest} lines outside the tests: search it, read the files the story needs). Then:`);
	lines.push('- **A video** (the generate-video skill): write `storyboard.json`, `prs check`, `prs direct`, then `prs voice` in the background while you fill `scenes.js`; `prs preview`, look, fix; `prs publish`.');
	lines.push('- **A deck** (the generate-presentation skill): write the slides in `decks/<slug>/deck.mjs` (layouts: its `layouts.md`), then `prs deck build`, look, fix.');
	fs.writeFileSync(path.join(dir, 'brief.md'), `${lines.join('\n')}\n`);
}

export async function newVideo(input, second, { force = false, skeleton = true } = {}) {
	const ref = parsePrRef(input, second);
	const dir = videoDir(ref.slug);
	if (isOffline()) {
		// No network (an agent sandbox): the setup ran prs new before the agent started; continue from there.
		if (!fs.existsSync(path.join(dir, 'pr.json'))) {
			throw new Error(`Offline (PRS_OFFLINE): ${ref.full}#${ref.number} was not downloaded before this run (prs new needs the network once)`);
		}
		return { ref, data: readJson(path.join(dir, 'pr.json')), reused: true };
	}
	if (fs.existsSync(path.join(dir, 'storyboard.json')) && !force) {
		throw new Error(`videos/${ref.slug} already exists. Continue there, or run prs new ${input} --force to refetch (keeps your storyboard and scenes).`);
	}
	fs.mkdirSync(dir, { recursive: true });
	const data = await fetchPr(ref);
	fs.writeFileSync(path.join(dir, 'pr.diff'), data.diff);
	writeBrief(dir, data);
	const code = await cacheChangedFiles(ref.slug, data.facts);
	// Last: another run (a deck of the same PR) takes the folder as complete once pr.json is there.
	writeJson(path.join(dir, 'pr.json'), { facts: data.facts, body: data.body, discussion: data.discussion, pictures: data.pictures, symbols: data.symbols, tests: data.tests, tier: data.tier });
	const sb = path.join(dir, 'storyboard.json');
	// A deck shares the fetched PR but has no storyboard: only a video starts one.
	if (skeleton && !fs.existsSync(sb)) {
		const middle = Array.from({ length: data.tier.beats - 2 }, (_, i) => ({ id: `beat${i + 2}`, need: 'TODO', say: 'TODO', cues: {}, claims: [] }));
		writeJson(sb, {
			pr: { repo: ref.full, number: ref.number, headSha: data.facts.headSha },
			pronounce: {},
			beats: [
				{ id: 'title', need: 'title', say: 'TODO: what the PR does, in one sentence (the title card shows its number, author, size and state: leave those out)', cues: {}, claims: [] },
				...middle,
				{ id: 'status', need: 'status', say: 'TODO: what matters most before review or merge, in one sentence (the screen lists the rest and where to start reading)', cues: {}, claims: [] },
			],
		});
	}
	return { ref, data, code };
}
