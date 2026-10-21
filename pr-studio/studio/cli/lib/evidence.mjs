// Evidence for storyboard claims, checked against the PR. Accepted forms:
//   { file, anchor }               the anchor (text or regex) is in the file at the head commit (any file of the
//                                  repository, changed or not: behaviour that lives outside the diff)
//   { file, anchor, removed: true } the anchor is on a line this PR removes (pr.diff)
//   { body: "exact text" }          an exact quote of the PR description (Markdown markers ignored)
//   { commit: "exact text" }        part of a commit message
//   { review: "exact text" }        words from the review discussion (reviews, comments on lines, the conversation)
//   { fact: "additions" }           a value in pr.json facts (also "facts.additions")
//   { file, status }                the PR changes that file
import fs from 'node:fs';
import path from 'node:path';
import { videoDir } from './common.mjs';
import { fileAtHead } from './code.mjs';

const norm = s => String(s).replace(/\s+/g, ' ').trim();

/** Markdown out of the way: **bold**, `code`, [text](url), > quotes, list bullets. */
export function stripMarkdown(text) {
	return String(text)
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/(\*\*|__|`)/g, '')
		.replace(/^\s*>\s?/gm, '')
		.replace(/^\s*[-*+]\s+/gm, '');
}

export function bodyCorpus(pr) {
	return `${norm(pr.body ?? '')}\n${norm(stripMarkdown(pr.body ?? ''))}`;
}

/** What people said in review, as plain text (Markdown markers ignored). */
export function reviewCorpus(pr) {
	return (pr.discussion ?? []).map(d => `${norm(d.body)}\n${norm(stripMarkdown(d.body))}`).join('\n');
}

export function removedLines(slug, file) {
	const diff = fs.readFileSync(path.join(videoDir(slug), 'pr.diff'), 'utf8');
	const out = [];
	let current = null;
	for (const line of diff.split('\n')) {
		const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
		if (m) {
			current = m[2];
			continue;
		}
		if (current === file && line.startsWith('-') && !line.startsWith('---')) {
			out.push(line.slice(1));
		}
	}
	return out.join('\n');
}

function anchorIn(text, anchor) {
	if (text.includes(anchor)) {
		return true;
	}
	try {
		return new RegExp(anchor).test(text);
	} catch {
		return false;
	}
}

/** Where a piece of evidence is, in a line a reviewer can check at a glance: the file and line it anchors, or the quote. */
export function evidenceLine(slug, pr, ev) {
	const cut = t => String(t).replace(/\s+/g, ' ').trim().slice(0, 140);
	if (ev.fact !== undefined) {
		const key = String(ev.fact).replace(/^facts\./, '');
		return `pr.json ${key} = ${cut(JSON.stringify(key.split('.').reduce((o, k) => o?.[k], pr.facts)))}`;
	}
	for (const kind of ['body', 'review', 'commit']) {
		if (ev[kind] !== undefined) {
			return `${kind === 'body' ? 'PR description' : kind === 'review' ? 'review discussion' : 'commit message'}: "${cut(ev[kind])}"`;
		}
	}
	if (!ev.file) {
		return cut(JSON.stringify(ev));
	}
	if (ev.status !== undefined && !ev.anchor) {
		return `${ev.file} (${ev.status} in this PR)`;
	}
	try {
		const lines = (ev.removed ? removedLines(slug, ev.file) : fileAtHead(slug, pr.facts, ev.file)).split('\n');
		const k = lines.findIndex(l => anchorIn(l, ev.anchor ?? ''));
		return k < 0 ? `${ev.file}: "${cut(ev.anchor)}" (spans lines)` : `${ev.file}${ev.removed ? ' (removed)' : `:${k + 1}`}: ${cut(lines[k])}`;
	} catch (error) {
		return `${ev.file}: ${error.message}`;
	}
}

/** Returns null when the evidence holds, else a message saying what to fix. */
export function checkEvidence(slug, pr, ev) {
	if (ev.fact !== undefined) {
		const key = String(ev.fact).replace(/^facts\./, '');
		return key.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), pr.facts) === undefined ? `fact "${ev.fact}" is not in pr.json facts` : null;
	}
	if (ev.pr_body !== undefined && ev.body === undefined) {
		ev = { ...ev, body: ev.pr_body };
	}
	if (ev.body !== undefined) {
		return bodyCorpus(pr).includes(norm(stripMarkdown(ev.body))) ? null : `body quote not found in the PR description: "${ev.body}"`;
	}
	if (ev.review !== undefined) {
		return reviewCorpus(pr).includes(norm(stripMarkdown(ev.review))) ? null : `not in the review discussion (brief.md, "Review discussion"): "${ev.review}"`;
	}
	if (ev.commit !== undefined) {
		return (pr.facts.commits ?? []).some(c => norm(c.message ?? c.headline).includes(norm(ev.commit))) ? null : `no commit message contains "${ev.commit}"`;
	}
	if (!ev.file) {
		return 'evidence needs { file, anchor }, { file, anchor, removed: true }, { body }, { commit } or { review }';
	}
	if (/^(brief\.md|pr\.json|pr\.diff|storyboard\.json)$/.test(ev.file)) {
		return `"${ev.file}" is a pr-studio file, not part of the PR: cite the repository file, or use { body: "exact quote" } for the PR description`;
	}
	if (ev.status !== undefined && !ev.anchor) {
		return pr.facts.files.some(f => f.path === ev.file) ? null : `${ev.file} is not changed by this PR`;
	}
	if (ev.removed) {
		return anchorIn(removedLines(slug, ev.file), ev.anchor ?? '') ? null : `"${ev.anchor}" is not on a line this PR removes from ${ev.file}`;
	}
	try {
		const text = fileAtHead(slug, pr.facts, ev.file);
		return !ev.anchor || anchorIn(text, ev.anchor) ? null : `"${ev.anchor}" is not in ${ev.file} at ${pr.facts.headSha9} (for a removed line add removed: true)`;
	} catch (error) {
		return error.message;
	}
}
