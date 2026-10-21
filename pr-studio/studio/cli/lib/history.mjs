// The ledger: what each published video used, so the next one can look different. In the repository it is the
// gallery's (gallery/history.jsonl); in a copy the plugin installed, it lives in the state folder
// (~/.cache/pr-studio/history.jsonl), so it outlasts updates of the engine.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { IN_REPO, ROOT, STATE, loadConfig } from './common.mjs';

export const HISTORY = IN_REPO ? path.join(ROOT, 'gallery', 'history.jsonl') : path.join(STATE, 'history.jsonl');
const parseLines = text => text.split('\n').filter(Boolean).map(l => JSON.parse(l));

export function readHistory(file = HISTORY) {
	if (!fs.existsSync(file)) {
		return [];
	}
	return parseLines(fs.readFileSync(file, 'utf8'));
}

/** One entry per video (the newest wins), oldest first. */
export function mergeHistory(...lists) {
	const bySlug = new Map();
	for (const e of lists.flat()) {
		const prev = bySlug.get(e.slug);
		if (!prev || String(e.date) >= String(prev.date)) {
			bySlug.set(e.slug, e);
		}
	}
	return [...bySlug.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/**
 * Cloud sessions (Slack requests) can only push to their own copilot/* branch, so each commits its
 * gallery/history.jsonl there; this merges the history of every such branch into the local file. The tidy workflow
 * runs it daily and commits the result to main, so the next session starts from a checkout that knows them all.
 */
export function collectHistory({ cwd = ROOT, remote = 'origin' } = {}) {
	const file = path.join(cwd, 'gallery', 'history.jsonl');
	const run = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
	run(['fetch', '-q', '--prune', remote, '+refs/heads/copilot/*:refs/prs-sessions/*']);
	const refs = run(['for-each-ref', '--format=%(refname)', 'refs/prs-sessions/']).split('\n').filter(Boolean);
	const theirs = [];
	for (const ref of refs) {
		try {
			theirs.push(...parseLines(run(['show', `${ref}:gallery/history.jsonl`])));
		} catch {
			// a branch without the file
		}
	}
	const mine = readHistory(file);
	const merged = mergeHistory(mine, theirs);
	const added = merged.length - mine.length;
	if (JSON.stringify(merged) !== JSON.stringify(mine)) {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, merged.map(e => JSON.stringify(e)).join('\n') + '\n');
	}
	return { branches: refs.length, added, total: merged.length };
}

export function addToHistory(entry) {
	fs.mkdirSync(path.dirname(HISTORY), { recursive: true });
	const rest = readHistory().filter(e => e.slug !== entry.slug);
	fs.writeFileSync(HISTORY, [...rest, entry].map(e => JSON.stringify(e)).join('\n') + '\n');
}

/** Treatments of the middle beats (the title frame is fixed and the closing beat has few options). */
export function middle(treatments) {
	const list = Object.values(treatments);
	return list.slice(1, -1).filter(t => t !== 'ui.footage');
}

/** Problems when this video repeats the recent ones. meta: { motion, beats: [{ id, treatment }] } */
export function noveltyProblems(slug, meta) {
	const { novelty } = loadConfig();
	const recent = readHistory().filter(e => e.slug !== slug).slice(-novelty.lookback);
	if (!recent.length || !meta) {
		return [];
	}
	const mine = middle(Object.fromEntries(meta.beats.map(b => [b.id, b.treatment])));
	const problems = [];
	const last = recent.at(-1);
	const share = list => mine.filter(t => list.includes(t)).length / Math.max(1, mine.length);
	const lastShare = share(middle(last.treatments));
	if (lastShare > novelty.maxRepeatShare) {
		problems.push(`${Math.round(lastShare * 100)}% of the explanation beats reuse treatments of the last video (${last.slug}); run prs direct for new ones or explain the override in direction.json`);
	} else if (meta.motion === last.motion && meta.motion !== 'slides' && lastShare >= 0.34) {
		problems.push(`same motion (${meta.motion}) and ${Math.round(lastShare * 100)}% of the treatments as the last video (${last.slug})`);
	}
	for (const e of recent) {
		const theirs = middle(e.treatments);
		if (theirs.length === mine.length && [...theirs].sort().join() === [...mine].sort().join()) {
			problems.push(`the same set of treatments as ${e.slug}`);
		}
	}
	return problems;
}

export function printHistory(n = 8) {
	const all = readHistory().slice(-n);
	if (!all.length) {
		console.log('No published videos yet.');
		return;
	}
	for (const e of all) {
		console.log(`${e.date.slice(0, 10)}  ${e.slug.padEnd(32)} ${String(e.seconds).padStart(5)} s  ${e.motion.padEnd(6)}  ${middle(e.treatments).join(', ')}`);
	}
}
