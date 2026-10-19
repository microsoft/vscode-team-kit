// Builds a deck: slide content -> HTML -> checks -> PDF + one PNG per page + contact sheet + speaker notes.
// A deck is a folder with deck.mjs (the slides, as plain data), and optionally designs/ (layouts of its own) and
// assets/ (pictures). `prs deck build <slug>` builds decks/<slug>/; everything it makes goes into <deck>/out/.
// A slide with `clicks` is drawn once per click: one click = the next PDF page; its layout reads ctx.step (1-based).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { chromePath } from '../cli/lib/browser.mjs';
import { LAYOUTS, DECK, ROOT, htmlRef, esc, fmt, plain, ic, qrSvg } from './layouts.mjs';
import { DIAGRAMS, logo } from './diagrams.mjs';
import { deckPages } from './pages.mjs';
import { loadDesigns } from './designs.mjs';
import * as kit from './kit.mjs';

/** The built-in layouts and diagrams, by name. */
export const BUILT_IN = { ...LAYOUTS, ...DIAGRAMS };
// Layouts that are mostly text in boxes. A deck should be at least half diagrams, pictures and big single ideas.
const TEXTY = new Set(['checklist', 'steps', 'pillars', 'board', 'grid', 'matrix', 'split', 'term']);
// Layouts drawn without the header line and slide counter (a design asks for it with `bare: true`).
const BARE_LAYOUTS = new Set(['title', 'end']);
const THEME = path.join(ROOT, 'deck', 'theme');

// Minutes per slide, for the notes and the section dividers: about one a slide, 4 for a poll or a live demo.
const MINUTES_PER = { slide: 1, interactive: 4 };
function slideMinutes(s) {
	if (typeof s.minutes === 'number') {
		return s.minutes;
	}
	const live = /live/i.test(typeof s.tag === 'object' ? s.tag?.text ?? '' : s.tag ?? '');
	return s.layout === 'poll' || live ? MINUTES_PER.interactive : s.layout === 'section' ? 0.5 : MINUTES_PER.slide;
}

/** A short name for a slide, also when it has no title (hero, statement, quote). */
function slideName(s) {
	const hero = s.value ? `${s.logoText ? `${s.logoText}: ` : ''}${s.value} ${s.label ?? ''}` : null;
	return plain(s.title ?? s.term ?? s.text ?? hero ?? s.eyebrow ?? s.layout).replace(/\s*\n\s*/g, ' ').trim();
}

function sourceText(src) {
	return typeof src === 'string' ? src.split(' | ')[0] : src.text;
}
function sourceUrl(src) {
	return typeof src === 'string' ? src.split(' | ')[1] ?? '' : src.url ?? '';
}

/** The bar under a click-by-click slide: numbered dots (done, now, next) and the caption of the current step. */
function stepBar(p) {
	const steps = p.s.clicks;
	if (!steps?.length || !p.step) {
		return '';
	}
	const dots = steps.map((st, k) => {
		const state = k + 1 < p.step ? 'done' : k + 1 === p.step ? 'now' : 'next';
		return `<span class="bs-dot ${state}" data-t>${k + 1}</span>`;
	}).join('');
	return `<div class="bs-bar"><span class="bs-dots">${dots}</span><span class="bs-cap" data-t>${fmt(steps[p.step - 1].caption)}</span></div>`;
}

/** "m:ss" or "h:mm:ss" for a number of seconds. */
function clock(seconds) {
	const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), sec = seconds % 60;
	return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** Seconds from a YouTube-style time ("549", "549s", "9m09s", "1h2m3s"). */
function seconds(t) {
	const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(t ?? '');
	return m ? (Number(m[1] ?? 0) * 3600) + (Number(m[2] ?? 0) * 60) + Number(m[3] ?? 0) : null;
}

const SITES = {
	'github.com': 'GitHub', 'youtube.com': 'YouTube', 'youtu.be': 'YouTube', 'x.com': 'X', 'twitter.com': 'X',
	'docs.github.com': 'GitHub Docs', 'github.blog': 'GitHub blog', 'code.visualstudio.com': 'VS Code docs',
	'claude.com': 'Claude', 'platform.claude.com': 'Claude docs', 'support.claude.com': 'Claude help', 'claude.dev': 'Claude blog',
	'anthropic.com': 'Anthropic', 'openai.com': 'OpenAI', 'openrouter.ai': 'OpenRouter', 'supabase.com': 'Supabase docs',
	'arxiv.org': 'arXiv', 'news.ycombinator.com': 'Hacker News', 'reddit.com': 'Reddit',
};

/** Where a link goes, in words. Never a cut-off address: a PDF viewer would turn that into a broken link. */
export function linkWhere(l) {
	if (l.where) {
		return l.where;
	}
	let u;
	try {
		u = new URL(l.url);
	} catch {
		return '';
	}
	const host = u.hostname.replace(/^www\./, '');
	const parts = u.pathname.split('/').filter(Boolean);
	const t = seconds(u.searchParams.get('t') ?? (/(?:^|&)t=([^&]+)/.exec(u.hash.slice(1))?.[1]));
	const at = l.from ?? (t ? clock(t) : null);
	const from = at ? ` \u00b7 from ${at}` : '';
	if (host === 'github.com') {
		const repo = parts.slice(0, 2).join('/');
		const last = parts.length > 4 ? parts[parts.length - 1] : '';
		return `GitHub \u00b7 ${repo}${last ? ` \u00b7 ${last}` : ''}`;
	}
	if (host === 'x.com' || host === 'twitter.com') {
		return `X \u00b7 @${parts[0]}${from}`;
	}
	if (host.endsWith('youtube.com') || host === 'youtu.be') {
		return `YouTube${from}`;
	}
	if (host === 'code.visualstudio.com') {
		return parts[0] === 'blogs' ? 'VS Code blog' : parts[0] === 'updates' ? 'VS Code release notes' : 'VS Code docs';
	}
	return `${SITES[host] ?? host}${from}`;
}

/** A QR code with a short label in the bottom-right corner, and a real link in the PDF.
 * link: { url, label, logo (deck/theme/logos slug), icon, caption, where (override the "where" line), from ('20:59' for a video
 * that can't start at a minute from its link, e.g. on X) } */
function linkBadge(l) {
	const mark = l.logo ? logo(l.logo, 26) : ic(l.icon ?? 'link', 24, 'var(--blue)');
	const video = /youtube\.com|youtu\.be|\.mp4$/.test(l.url) || !!l.from;
	const caption = l.caption ?? (video ? 'Scan or click to watch' : 'Scan or click to open');
	return `<a class="link-badge" href="${esc(l.url)}" data-t><span class="lb-text"><span class="lb-cap">${esc(caption)}</span><span class="lb-title">${mark}<span>${fmt(l.label)}</span></span><span class="lb-where">${esc(linkWhere(l))}</span></span>${qrSvg(l.url)}</a>`;
}

const PAGE_SCRIPT = `
window.__fit = async () => {
	await document.fonts.ready;
	for (const el of document.querySelectorAll('[data-autofit]')) {
		const width = Number(el.dataset.autofit);
		let size = parseFloat(getComputedStyle(el).fontSize);
		const from = size;
		let guard = 0;
		while (el.scrollWidth > width + 0.5 && size > 14 && guard++ < 160) {
			size -= 1;
			el.style.fontSize = size + 'px';
		}
		if (guard) { el.dataset.shrunk = String(size); el.dataset.from = String(from); }
	}
	window.__READY__ = true;
};
window.__lint = () => {
	const out = [];
	for (const slide of document.querySelectorAll('.slide')) {
		const n = Number(slide.dataset.n);
		const sr = slide.getBoundingClientRect();
		const label = el => (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
		for (const box of slide.querySelectorAll('[data-fit]')) {
			if (box.scrollWidth > box.clientWidth + 2 || box.scrollHeight > box.clientHeight + 2) {
				out.push({ n, kind: 'overflow', text: label(box) });
			}
		}
		for (const el of slide.querySelectorAll('.sources')) {
			if (el.scrollWidth > el.clientWidth + 1) out.push({ n, kind: 'sources line cut off (shorten the names or dates, or drop one; the notes keep every link)', text: label(el) });
		}
		const shown = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
		const texts = [...slide.querySelectorAll('[data-t]')].filter(el => shown(el) && el.textContent.trim());
		for (const el of texts) {
			const r = el.getBoundingClientRect();
			const x0 = r.left - sr.left, x1 = r.right - sr.left, y0 = r.top - sr.top, y1 = r.bottom - sr.top;
			if (x0 < 60 || x1 > 1860 || y0 < 24 || y1 > 1062) {
				out.push({ n, kind: 'outside the frame', text: label(el) });
			}
		}
		for (let i = 0; i < texts.length; i++) {
			for (let j = i + 1; j < texts.length; j++) {
				const a = texts[i], b = texts[j];
				if (a.contains(b) || b.contains(a)) continue;
				const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
				const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
				const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
				if (ix > 3 && iy > 3) out.push({ n, kind: 'overlap', text: label(a) + '  <->  ' + label(b) });
			}
		}
		for (const el of slide.querySelectorAll('[data-shrunk]')) {
			const size = Number(el.dataset.shrunk), from = Number(el.dataset.from);
			if (size < from * 0.82 && !el.closest('.chrome-tier')) out.push({ n, kind: 'text shrunk from ' + from + 'px to ' + size + 'px to fit (shorten it)', text: label(el) });
		}
		for (const region of slide.querySelectorAll('.body, .stmt, .quote, .sec')) {
			const rr = region.getBoundingClientRect();
			let top = Infinity, bottom = -Infinity;
			for (const el of region.querySelectorAll('*')) {
				if (el.parentElement?.closest('.shot')) continue; // a cropped screenshot is clipped by its frame
				const r = el.getBoundingClientRect();
				if (!r.width || !r.height) continue;
				top = Math.min(top, r.top);
				bottom = Math.max(bottom, r.bottom);
			}
			if (top < rr.top - 2 || bottom > rr.bottom + 2) out.push({ n, kind: 'content taller than its area (cut text or items)', text: Math.round(top - sr.top) + '..' + Math.round(bottom - sr.top) + 'px, area ' + Math.round(rr.top - sr.top) + '..' + Math.round(rr.bottom - sr.top) + 'px' });
		}
		for (const m of slide.querySelectorAll('[data-missing]')) out.push({ n, kind: 'missing screenshot', text: m.dataset.missing });
		// macOS Preview draws a blurred shadow, or anything under a CSS filter, as a solid gray box in the PDF.
		const blurred = v => !!v && v !== 'none' && v.split(/,(?![^(]*\\))/).some(sh => ((sh.replace(/[a-z-]+\\([^)]*\\)/g, '').match(/-?[\\d.]+px/g) ?? []).map(parseFloat)[2] ?? 0) > 0);
		for (const el of slide.querySelectorAll('*')) {
			const cs = getComputedStyle(el);
			if (cs.visibility === 'hidden' || !el.getClientRects().length) continue;
			const inheritedText = el.parentElement && getComputedStyle(el.parentElement).textShadow === cs.textShadow;
			if (blurred(cs.boxShadow) || (blurred(cs.textShadow) && !inheritedText) || cs.filter !== 'none' || (cs.backdropFilter ?? 'none') !== 'none') {
				out.push({ n, kind: 'blurred shadow or filter (macOS Preview shows a gray box; use a sharp ring)', text: (el.getAttribute('class') || el.tagName.toLowerCase()) + (label(el) ? ': ' + label(el) : '') });
			}
		}
		// A design plugin draws its own HTML: every visible text in it needs data-t, or the checks above can't see it.
		if (slide.hasAttribute('data-plugin')) {
			const loose = [];
			const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
			for (let t = walker.nextNode(); t; t = walker.nextNode()) {
				const el = t.parentElement;
				if (!/[A-Za-z0-9]/.test(t.textContent) || !el || el.closest('[data-t], .head, .chrome-ref, .chrome-count, .chrome-tier, .sources, .link-badge, style, script') || !el.getClientRects().length) continue;
				loose.push(t.textContent.trim().slice(0, 40));
			}
			if (loose.length) out.push({ n, kind: 'text without data-t (add data-t, so the word count and the overflow checks see it)', text: loose.slice(0, 3).join(' | ') });
		}
		// Words the audience has to read, besides the title. Chrome, sources, the link badge, code lines and labels (eyebrows,
		// numbered badges, small-caps labels, file names, initials) don't count.
		if (!['section', 'title', 'end', 'agenda'].includes(slide.dataset.layout) && !slide.hasAttribute('data-bare')) {
			const skip = '.head, .chrome-ref, .chrome-count, .chrome-tier, .sources, .link-badge, .code-lines, .tx-body, .st-eyebrow, .st-badge, .lbl, .chat-label, .fx-name, .av, .beat-time, .sx-time, .sp-head, .bs-bar.all, .bs-dot, .ht-ui, .head-tag, .seq-n, .code-head, .counter-num, .hero-value, .mx-h, .nolint';
			const counted = [...slide.querySelectorAll('[data-t]')].filter(el => !el.closest(skip) && shown(el));
			const set = new Set(counted);
			let words = 0;
			for (const el of counted) {
				let up = el.parentElement, nested = false;
				while (up && up !== slide) { if (set.has(up)) { nested = true; break; } up = up.parentElement; }
				if (!nested) words += (el.textContent || '').split(/\\s+/).filter(w => /[A-Za-z0-9]/.test(w)).length;
			}
			slide.dataset.words = String(words);
			// [keep to, warn above]. A story may tell more; a slide may carry an agreed exception (maxWords).
			const story = slide.dataset.layout === 'story' || slide.hasAttribute('data-story');
			// A deck about a PR is held to the limit itself; other decks warn a little above it.
			const strict = document.body.hasAttribute('data-strict-words');
			const limits = slide.dataset.maxWords ? [Number(slide.dataset.maxWords), Number(slide.dataset.maxWords)] : story ? [45, strict ? 45 : 50] : [25, strict ? 25 : 30];
			if (words > limits[1]) out.push({ n, kind: 'too much text: ' + words + ' words besides the title (keep it to ' + limits[0] + '; move the rest to the notes)', text: label(slide.querySelector('.st-title') || slide) });
		}
	}
	// Nothing may jump between the clicks of one slide: every element with data-key keeps its place on every page of
	// that slide (hidden elements keep their place too, so later clicks can reveal them in position).
	const bySlide = new Map();
	for (const slide of document.querySelectorAll('.slide[data-step]')) {
		const list = bySlide.get(slide.dataset.slide) ?? [];
		list.push(slide);
		bySlide.set(slide.dataset.slide, list);
	}
	for (const slides of bySlide.values()) {
		const seen = new Map();
		for (const slide of slides) {
			const sr = slide.getBoundingClientRect();
			for (const el of slide.querySelectorAll('[data-key]')) {
				const r = el.getBoundingClientRect();
				const box = [r.left - sr.left, r.top - sr.top, r.width, r.height].map(v => Math.round(v));
				const first = seen.get(el.dataset.key);
				if (!first) {
					seen.set(el.dataset.key, { box, n: Number(slide.dataset.n) });
				} else if (box.some((v, i) => Math.abs(v - first.box[i]) > 1)) {
					out.push({ n: Number(slide.dataset.n), kind: 'moves between clicks (keep it in place on every click)', text: el.dataset.key + ': ' + first.box.join(',') + ' on page ' + first.n + ', ' + box.join(',') + ' here' });
				}
			}
		}
	}
	return out;
};
window.__fit();
`;

// ---------- static checks ----------

function slideText(s) {
	const skip = new Set(['notes', 'sources', 'id', 'layout', 'tier', 'icon', 'tone', 'remember', 'code', 'src', 'lang', 'file', 'dir', 'answer', 'nosrc', 'defines', 'aliases', 'allowTerms', 'term', 'url', 'qr', 'link', 'say', 'bg', 'logo']);
	const parts = [];
	const walk = v => {
		if (typeof v === 'string') {
			parts.push(plain(v));
		} else if (Array.isArray(v)) {
			v.forEach(walk);
		} else if (v && typeof v === 'object') {
			for (const [k, x] of Object.entries(v)) {
				if (!skip.has(k)) {
					walk(x);
				}
			}
		}
	};
	walk(s);
	return parts.join(' \n ');
}

function staticChecks(pages, bare) {
	const out = [];
	// Statistics: thousands, percentages, multipliers, money, k/M suffixes, and numbers with 3+ digits that aren't years.
	const number = /\b\d{1,3}(?:[,'\u2019]\d{3})+\b|\b\d+(?:\.\d+)?\s?%|\b\d+(?:\.\d+)?\s?[x\u00d7](?![a-z])|[$\u20ac\u00a3]\s?\d|\bCHF\s?\d|\b\d+(?:\.\d+)?\s?(?:k|K|M|bn|million|billion)\b|(?<!#)\b(?!(?:19|20)\d\d\b)\d{3,}\b/;
	const terms = new Map();
	const addTerm = (name, at) => {
		for (const variant of [name, name.replace(/^(the|a|an)\s+/i, '')]) {
			const key = plain(variant).toLowerCase().trim();
			if (key && !terms.has(key)) {
				terms.set(key, at);
			}
		}
	};
	pages.forEach((p, i) => {
		if (p.reveal || !p.first) {
			return;
		}
		const s = p.s;
		if (s.layout === 'term') {
			addTerm(s.term, i);
			for (const a of s.aliases ?? []) {
				addTerm(a, i);
			}
		}
		for (const d of s.defines ?? []) {
			addTerm(d, i);
		}
		if (!bare(s) && s.layout !== 'section' && s.layout !== 'agenda' && !s.nosrc && !s.sources?.length && number.test(slideText(s))) {
			out.push({ n: i + 1, kind: 'number without a source', text: (slideText(s).match(number) ?? [''])[0] });
		}
		if (!s.notes && !bare(s)) {
			out.push({ n: i + 1, kind: 'no speaker notes', text: slideName(s).slice(0, 60) });
		}
		if (typeof s.say === 'string' && plain(s.say).length > 70) {
			out.push({ n: i + 1, kind: `say line longer than 70 characters (${plain(s.say).length}): one line to remember`, text: plain(s.say).slice(0, 60) });
		}
		if (/\bTODO\b/.test(JSON.stringify(s))) {
			out.push({ n: i + 1, kind: 'placeholder left (TODO)', text: slideName(s).slice(0, 60) });
		}
		for (const [k, st] of (s.clicks ?? []).entries()) {
			if (!st.caption || !st.say) {
				out.push({ n: i + k + 1, kind: 'click without a caption or say line', text: `${slideName(s).slice(0, 40)}, step ${k + 1}` });
			}
		}
	});
	// A different design on every slide: neighbours differ, and a part uses a layout at most twice. A story's look counts
	// as its own design (story:road and story:number are different pictures).
	const design = s => s.layout + (s.look ? `:${s.look}` : '');
	const kept = pages.filter(p => !p.reveal && p.first);
	kept.forEach((p, i) => {
		const prev = kept[i - 1];
		if (prev && prev.section === p.section && design(prev.s) === design(p.s) && p.s.layout !== 'section') {
			out.push({ n: pages.indexOf(p) + 1, kind: 'same design as the previous slide (pick another layout)', text: design(p.s) });
		}
	});
	for (const sec of new Set(kept.map(p => p.section))) {
		const own = kept.filter(p => p.section === sec && p.s.layout !== 'section');
		const seen = new Map();
		for (const p of own) {
			seen.set(design(p.s), (seen.get(design(p.s)) ?? 0) + 1);
			if (seen.get(design(p.s)) === 3) {
				out.push({ n: pages.indexOf(p) + 1, kind: 'layout used a third time in this section (use another design)', text: design(p.s) });
			}
		}
		const texty = own.filter(p => TEXTY.has(p.s.layout)).length;
		if (own.length >= 4 && texty * 2 > own.length) {
			out.push({ n: pages.indexOf(own[0]) + 1, kind: `text-box layouts on ${texty} of ${own.length} slides in this section (make at least half diagrams, pictures or big single ideas)`, text: sec.short ?? sec.title });
		}
	}
	for (const [name, at] of terms) {
		const re = new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(e?s)?($|[^a-z0-9])`);
		pages.slice(0, at).forEach((p, i) => {
			if (!p.reveal && p.first && !(p.s.allowTerms ?? []).map(x => x.toLowerCase()).includes(name) && re.test(slideText(p.s).toLowerCase())) {
				out.push({ n: i + 1, kind: 'term used before it is explained', text: `"${name}" (explained on slide ${at + 1})` });
			}
		});
	}
	return out;
}

function luminance(hex) {
	const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
	return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
	const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
	return (x + 0.05) / (y + 0.05);
}

// ---------- a deck about a pull request: its code and paths must come from the PR ----------

const norm = t => String(t).replace(/\s+/g, ' ').trim();

/** The text a slide shows from its own fields: not its notes, sources, links, ids or code (checked on its own). */
function slideStrings(s) {
	const skip = new Set(['notes', 'sources', 'say', 'link', 'url', 'id', 'layout', 'icon', 'tone', 'logo', 'code', 'lang', 'file', 'dir', 'src', 'image', 'alt', 'bg', 'look', 'qr', 'pr', 'resultTone', 'subTone', 'replyTone']);
	const out = [];
	const walk = v => {
		if (typeof v === 'string') {
			out.push(v);
		} else if (Array.isArray(v)) {
			v.forEach(walk);
		} else if (v && typeof v === 'object') {
			for (const [k, x] of Object.entries(v)) {
				if (!skip.has(k)) {
					walk(x);
				}
			}
		}
	};
	walk(s);
	return out;
}

/** The PR a deck is about (deck.pr: 'owner/repo#n'), from what prs new fetched: the paths it changes, and one text with
 * its diff, description, commit messages and the changed files at the head commit. */
async function loadPr(deck) {
	const { buildDir, parsePrRef, readJson, videoDir } = await import('../cli/lib/common.mjs');
	const ref = parsePrRef(deck.pr);
	const dir = videoDir(ref.slug);
	if (!fs.existsSync(path.join(dir, 'pr.json'))) {
		throw new Error(`This deck is about ${deck.pr}, but its data is missing: run prs deck new --pr ${deck.pr} (or prs new ${deck.pr})`);
	}
	const { facts, body, discussion } = readJson(path.join(dir, 'pr.json'));
	const heads = facts.files
		.map(f => path.join(buildDir(ref.slug), 'src', facts.headSha9, f.path))
		.filter(f => fs.existsSync(f))
		.map(f => fs.readFileSync(f, 'utf8'));
	const diff = fs.readFileSync(path.join(dir, 'pr.diff'), 'utf8');
	return { ref, facts, paths: facts.files.map(f => f.path), corpus: norm([diff, body ?? '', facts.title, ...facts.commits.map(c => c.message), ...(discussion ?? []).map(d => d.body), ...heads].join('\n')) };
}

/** Code and paths on the slides that the PR doesn't have: in the diff, its description, its commits, its review
 * discussion or its files. */
export function prChecks(pages, pr) {
	const out = [];
	const known = t => {
		const x = norm(t);
		return x.length < 3 || pr.corpus.includes(x) || pr.paths.some(p => p.endsWith(x) || p.includes(x));
	};
	pages.forEach((p, i) => {
		if (p.reveal || !p.first) {
			return;
		}
		const s = p.s;
		if (typeof s.code === 'string') {
			// Every line of code, or each part around an ellipsis, is in the diff or a changed file.
			for (const raw of s.code.split('\n')) {
				const line = s.diff ? raw.slice(1) : raw;
				for (const part of line.split(/\u2026|\.\.\./)) {
					const t = norm(part);
					if (t.length >= 4 && !/^[{}()[\];,.\s]+$/.test(t) && !known(t)) {
						out.push({ n: i + 1, kind: 'code not in the PR (copy it from the diff or the file; shorten with \u2026)', text: t.slice(0, 90) });
					}
				}
			}
			if (s.file && !known(s.file)) {
				out.push({ n: i + 1, kind: 'a file the PR doesn\'t change', text: s.file });
			}
		}
		for (const text of slideStrings(s)) {
			for (const m of text.matchAll(/`([^`]+)`/g)) {
				// Shortened with an ellipsis: each part on its own must be in the PR.
				const parts = m[1].split(/\u2026|\.\.\./).map(x => x.trim()).filter(x => x.length >= 3);
				if (parts.length > 1 ? parts.some(x => !known(x)) : !known(m[1])) {
					out.push({ n: i + 1, kind: 'inline code not in the PR (check the spelling against the diff)', text: m[1].slice(0, 90) });
				}
			}
			const rest = text.replace(/`[^`]+`/g, ' ').replace(/https?:\/\/\S+/g, ' ');
			for (const m of rest.matchAll(/(?:[\w.-]+\/)+[\w.-]+\.[a-z]{1,5}\b/gi)) {
				if (!known(m[0])) {
					out.push({ n: i + 1, kind: 'a path the PR doesn\'t have', text: m[0] });
				}
			}
		}
	});
	return out;
}

/** A slide's word limit when it isn't the usual 25: its own `maxWords`, or 60 on a definition card (term). */
function maxWords(s) {
	return Number(s.maxWords) || (s.layout === 'term' ? 60 : 0);
}

/** WCAG contrast of the theme's text colours, for the checks report. */
function contrastReport() {
	const C = { ink: '#1b1b1f', body: '#5f6168', muted: '#72767e', blue: '#0078d4', green: '#107c10', red: '#d13438', orange: '#d83b01', purple: '#8661c5', yellow: '#9a6700' };
	const tints = { blue: '#eef4fd', green: '#eef7ea', red: '#fbeeed', orange: '#fcf1ec', purple: '#f3effa', yellow: '#fff6d4' };
	const lines = [];
	for (const [name, hex] of Object.entries(C)) {
		const r = contrast(hex, '#ffffff');
		const onTint = tints[name] ? `, on its tint ${contrast(hex, tints[name]).toFixed(2)}` : '';
		lines.push(`${name.padEnd(7)} ${hex} on white ${r.toFixed(2)}${r >= 4.5 ? ' (AA)' : r >= 3 ? ' (AA large text only)' : ' (FAILS)'}${onTint}`);
	}
	const DARK = '#1b1b1f';
	const onDark = { white: '#ffffff', grey: '#a9adb6', blue: '#6cb8f6', green: '#7bd389', red: '#f1707b', orange: '#f7a35c', purple: '#b9a1e8' };
	lines.push(`on dark ${DARK}: ${Object.entries(onDark).map(([k, v]) => `${k} ${contrast(v, DARK).toFixed(2)}`).join(', ')}`);
	lines.push(`on blue #0078d4: white ${contrast('#ffffff', '#0078d4').toFixed(2)} (AA)`);
	return lines;
}

/** Reads <dir>/deck.mjs: export default { title, ref, author, slides: [...] } or { title, ref, sections: [{ id, title, short,
 * number, slides }] }. `ref` is the small line at the top of every slide (e.g. 'Changelog videos  ·  October 2026'). */
export async function loadDeck(dir) {
	const file = path.join(dir, 'deck.mjs');
	if (!fs.existsSync(file)) {
		throw new Error(`${file} is missing (prs deck new <slug> writes one)`);
	}
	const deck = (await import(`${pathToFileURL(file).href}?v=${fs.statSync(file).mtimeMs}`)).default;
	if (!deck || (!Array.isArray(deck.slides) && !Array.isArray(deck.sections))) {
		throw new Error(`${file} must export default { title, ref, slides: [...] } (or sections: [{ id, title, slides }])`);
	}
	const sections = deck.sections ?? [{ id: 'deck', title: deck.title, slides: deck.slides }];
	return { ...deck, slug: path.basename(dir), sections, ref: deck.ref ?? deck.title ?? '' };
}

/** Builds the deck in `dir` into <dir>/out/. With deliverDir, copies the PDF, contact sheet, notes and a picture per slide there.
 * Returns { lint, report, files: { pdf, contact, notes, checks, slides, html }, delivered }. */
export async function buildDeck(dir, { pdf = true, png = true, deliverDir = null, outName = 'out' } = {}) {
	dir = path.resolve(dir);
	const deck = await loadDeck(dir);
	const pr = deck.pr ? await loadPr(deck) : null;
	const outDir = path.join(dir, outName);
	const pngDir = path.join(outDir, 'slides');
	fs.mkdirSync(outDir, { recursive: true });
	DECK.dir = dir;
	DECK.out = outDir;
	const files = {
		html: path.join(outDir, `${deck.slug}.html`),
		pdf: path.join(outDir, `${deck.slug}.pdf`),
		contact: path.join(outDir, 'contact.png'),
		notes: path.join(outDir, 'notes.md'),
		checks: path.join(outDir, 'checks.txt'),
		slides: pngDir,
	};

	const own = await loadDesigns(dir, BUILT_IN, kit);
	const layouts = { ...BUILT_IN, ...Object.fromEntries(Object.entries(own.designs).map(([name, d]) => [name, (s, ctx) => d.render(s, ctx)])) };
	const bare = s => BARE_LAYOUTS.has(s.layout) || !!own.designs[s.layout]?.bare;

	const { pages, slides: totalSlides } = deckPages(deck);
	if (!pages.length) {
		throw new Error(`${path.join(dir, 'deck.mjs')} has no slides`);
	}
	const total = pages.length;
	// Section dividers show where we are among the numbered sections of this deck.
	const parts = [...new Map(pages.filter(p => p.section.number).map(p => [p.section.id, p.section])).values()].map(sec => ({ id: sec.id, number: sec.number, title: sec.title, short: sec.short }));
	const partMinutes = new Map();
	for (const p of pages) {
		if (!p.reveal && p.first) {
			partMinutes.set(p.section.id, (partMinutes.get(p.section.id) ?? 0) + slideMinutes(p.s));
		}
	}
	// The title card can list the sections with their minutes (card: { rows: 'blocks' }), computed from this deck.
	const blocks = deck.sections.filter(sec => partMinutes.has(sec.id)).map(sec => ({ block: sec.short ?? sec.title, minutes: partMinutes.get(sec.id) }));
	const coreTotal = blocks.reduce((a, b) => a + b.minutes, 0);

	const frame = (p, inner, ctx) => {
		const s = p.s;
		const isBare = bare(s);
		const chrome = isBare ? '' : `<div class="chrome-ref" data-t>${esc(deck.ref)}</div><div class="chrome-count" data-t>${String(p.slideNo).padStart(2, '0')} / ${String(totalSlides).padStart(2, '0')}</div>`;
		const link = s.link && !isBare ? linkBadge(s.link) : '';
		const sourceItem = src => sourceUrl(src) ? `<a href="${esc(sourceUrl(src))}">${esc(sourceText(src))}</a>` : esc(sourceText(src));
		const sources = s.sources?.length ? `<div class="sources no-pill" data-t><b>Sources:</b> ${s.sources.map(sourceItem).join('  \u00b7  ')}</div>` : '';
		const progress = `<div class="progress"><i style="width:${((p.slideNo / totalSlides) * 100).toFixed(3)}%"></i></div>`;
		const steps = stepBar(p);
		const cls = `slide${s.bg ? ` bg-${s.bg}` : ''}${link ? ' has-link' : ''}${steps ? ' has-steps' : ''}`;
		const design = own.designs[s.layout];
		const attrs = [
			`data-n="${ctx.n}"`, `data-slide="${p.slideNo}"`, p.step ? `data-step="${p.step}"` : '', `data-id="${esc(s.id ?? '')}"`, `data-layout="${esc(s.layout)}"`,
			design ? 'data-plugin' : '', design?.story || s.story ? 'data-story' : '', isBare ? 'data-bare' : '', maxWords(s) ? `data-max-words="${maxWords(s)}"` : '',
		].filter(Boolean).join(' ');
		return `<section class="${cls}" ${attrs}>${chrome}${inner}${steps}${link}${sources}${progress}</section>\n`;
	};

	let htmlBody = '';
	for (const [i, p] of pages.entries()) {
		const layout = layouts[p.s.layout];
		if (!layout) {
			const mine = Object.keys(own.designs);
			throw new Error(`Slide ${p.slideNo} (${p.s.id ?? 'no id'}): unknown layout "${p.s.layout}". Built in: ${Object.keys(BUILT_IN).join(', ')}${mine.length ? `. This deck's designs: ${mine.join(', ')}` : ''}${own.problems.length ? `. Design problems: ${own.problems.map(x => `${x.kind}: ${x.text}`).join('; ')}` : ''}`);
		}
		const ctx = { n: i + 1, total, sectionId: p.section.id, parts, reveal: !!p.reveal, minutes: Math.max(1, Math.round(partMinutes.get(p.section.id) ?? 0)), blocks, coreTotal, hasBreak: false, step: p.step, steps: p.steps, slideNo: p.slideNo, totalSlides };
		let inner;
		try {
			inner = await layout(p.s, ctx);
		} catch (e) {
			throw new Error(`Slide ${p.slideNo} (${p.s.id ?? 'no id'}, layout ${p.s.layout}${p.step ? `, step ${p.step}` : ''}): ${e.message}`);
		}
		htmlBody += frame(p, inner, ctx);
	}
	const used = new Set(pages.map(p => p.s.layout));
	const designCss = Object.entries(own.css).filter(([name]) => used.has(name)).map(([, css]) => css).join('\n');
	fs.writeFileSync(files.html, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(deck.title ?? deck.slug)}</title><link rel="stylesheet" href="${htmlRef(path.join(THEME, 'studio.css'))}"><link rel="stylesheet" href="${htmlRef(path.join(THEME, 'deck.css'))}">${designCss ? `<style>\n${designCss}\n</style>` : ''}</head><body${deck.pr ? ' data-strict-words' : ''}>\n${htmlBody}<script>${PAGE_SCRIPT}</script></body></html>`);

	const executablePath = chromePath();
	if (!executablePath) {
		throw new Error('Chrome for Testing is missing: run prs doctor');
	}
	const browser = await chromium.launch({ executablePath, headless: true, args: ['--headless=new', '--hide-scrollbars', '--force-color-profile=srgb'] });
	let fonts, pageLint, words = [];
	const pageErrors = [];
	try {
		const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
		page.on('pageerror', e => pageErrors.push(e.message));
		page.on('requestfailed', r => {
			if (!/Aptos/.test(r.url())) {
				pageErrors.push(`${r.url()}: ${r.failure()?.errorText}`);
			}
		});
		await page.route('**/*', route => ['file:', 'data:'].includes(new URL(route.request().url()).protocol) ? route.continue() : route.abort());
		await page.goto(pathToFileURL(files.html).href);
		try {
			await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 60000 });
		} catch (e) {
			throw new Error(`The deck page did not finish drawing: ${pageErrors.join('; ') || e.message}`);
		}
		fonts = await page.evaluate(() => ({ aptos: [...document.fonts].some(f => f.family.replace(/"/g, '') === 'Aptos' && f.status === 'loaded') }));
		pageLint = await page.evaluate(() => window.__lint());
		words = await page.evaluate(() => [...document.querySelectorAll('.slide[data-words]')].map(el => [Number(el.dataset.n), Number(el.dataset.words)]));
		if (pdf) {
			await page.pdf({ path: files.pdf, width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true });
		}
		if (png) {
			fs.rmSync(pngDir, { recursive: true, force: true });
			fs.mkdirSync(pngDir, { recursive: true });
			const slides = page.locator('.slide');
			for (let i = 0; i < total; i++) {
				await slides.nth(i).screenshot({ path: path.join(pngDir, `${String(i + 1).padStart(3, '0')}.png`) });
			}
			// Contact sheet: every page on one image, labelled with its number, slide, click and name.
			const cols = Math.min(5, total);
			const thumbs = pages.map((p, i) => `<figure><img src="${pathToFileURL(path.join(pngDir, `${String(i + 1).padStart(3, '0')}.png`)).href}"><figcaption><b>${i + 1}</b> slide ${p.slideNo}${typeof p.step === 'number' ? `, click ${p.step}/${p.steps}` : ''}${p.reveal ? ', answer' : ''} \u00b7 ${esc(p.s.layout)} \u00b7 ${esc(slideName(p.s).slice(0, 40))}</figcaption></figure>`).join('');
			const contactHtml = path.join(outDir, 'contact.html');
			fs.writeFileSync(contactHtml, `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:32px;background:#eef0f3;font-family:Aptos,'Segoe UI',Inter,system-ui,sans-serif} .g{display:grid;grid-template-columns:repeat(${cols},384px);gap:22px} figure{margin:0} img{width:384px;height:216px;display:block;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.12);background:#fff} figcaption{margin-top:7px;font-size:13px;color:#5f6168;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:384px} b{color:#1b1b1f}</style></head><body><div class="g">${thumbs}</div></body></html>`);
			await page.setViewportSize({ width: cols * 384 + (cols - 1) * 22 + 64, height: 800 });
			await page.goto(pathToFileURL(contactHtml).href);
			await page.evaluate(() => Promise.all([...document.images].map(img => img.decode().catch(() => { }))));
			await page.screenshot({ path: files.contact, fullPage: true });
		}
	} finally {
		await browser.close();
	}

	const lint = [
		...own.problems.map(x => ({ n: 0, kind: x.kind, text: x.text })),
		...pageLint,
		...staticChecks(pages, bare),
		...(pr ? prChecks(pages, pr) : []),
	].sort((a, b) => a.n - b.n);

	// Speaker notes with full source links: one entry per slide, with its PDF pages and one line per click.
	const talkMinutes = Math.round(pages.filter(p => !p.reveal && p.first).reduce((a, p) => a + slideMinutes(p.s), 0) * 10) / 10;
	const notes = [`# ${deck.title ?? deck.slug}: speaker notes\n`, `${totalSlides} slides, ${total} PDF pages (one page per click), about ${talkMinutes} minutes. Built ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.\n`];
	pages.forEach((p, i) => {
		if (p.reveal) {
			notes.push(`### ${i + 1}. (the answer of ${i})\n`);
			return;
		}
		if (!p.first) {
			return;
		}
		const s = p.s;
		const span = pages.filter(q => q.s === s).map(q => pages.indexOf(q) + 1);
		const where = span.length > 1 ? `PDF pages ${span[0]}\u2013${span[span.length - 1]}` : `PDF page ${span[0]}`;
		const minutes = typeof s.minutes === 'number' ? ` \u00b7 about ${s.minutes} min` : '';
		notes.push(`### ${p.slideNo}. ${slideName(s)}  \n_${where}${minutes}_\n`);
		if (s.say ?? s.remember) {
			notes.push(`**Say:** ${plain(s.say ?? s.remember)}\n`);
		}
		if (s.clicks?.length) {
			notes.push(s.clicks.map((st, k) => `${k + 1}. **${plain(st.caption)}** (page ${span[k] ?? span[0]}): ${plain(st.say)}`).join('\n') + '\n');
		}
		if (s.notes) {
			notes.push(`${s.notes}\n`);
		}
		if (s.sources?.length) {
			notes.push(`Sources:\n${s.sources.map(src => `- ${sourceText(src)}${sourceUrl(src) ? ` \u2014 ${sourceUrl(src)}` : ''}`).join('\n')}\n`);
		}
	});
	fs.writeFileSync(files.notes, notes.join('\n'));

	const rel = f => path.relative(dir, f);
	// A slide with clicks counts on its fullest page.
	const perSlide = new Map();
	for (const [n, w] of words) {
		const p = pages[n - 1];
		if (p && !p.reveal) {
			perSlide.set(p.slideNo, Math.max(perSlide.get(p.slideNo) ?? 0, w));
		}
	}
	const report = [
		`${deck.title ?? deck.slug}: ${totalSlides} slides, ${total} pages, about ${talkMinutes} min`,
		`Font: ${fonts.aptos ? 'Aptos (from the local Office install)' : 'Aptos missing: Segoe UI or Inter instead'}`,
		...(pageErrors.length ? ['Page errors:', ...pageErrors.map(e => `  ${e}`)] : []),
		...(pr ? [`About ${pr.ref.full}#${pr.ref.number}: code, inline code and paths checked against its diff and files`] : []),
		`Designs: ${pages.filter(p => !p.reveal && p.first).map(p => p.s.layout + (p.s.look ? `:${p.s.look}` : '')).join(', ')}`,
		`Words besides the title, by slide (keep to 25): ${[...perSlide].map(([no, w]) => `${no}: ${w}`).join(', ') || 'none counted'}`,
		`Checks: ${lint.length ? `${lint.length} warning(s)` : 'clean'}`,
		...lint.map(w => `  ${w.n ? `page ${String(w.n).padStart(3)}` : 'deck    '}  ${w.kind}: ${w.text}`),
		'Text colours (WCAG contrast):',
		...contrastReport().map(l => `  ${l}`),
		`Output: ${[pdf && rel(files.pdf), png && rel(files.contact), png && `${rel(pngDir)}/`, rel(files.notes)].filter(Boolean).join(', ')}`,
	];
	let delivered = null;
	if (deliverDir) {
		const earlier = fs.existsSync(path.join(deliverDir, `${deck.slug}.pdf`)) ? fs.statSync(path.join(deliverDir, `${deck.slug}.pdf`)).mtime : null;
		fs.mkdirSync(deliverDir, { recursive: true });
		const fresh = [pdf && files.pdf, png && files.contact, files.notes].filter(Boolean);
		for (const f of fresh) {
			fs.copyFileSync(f, path.join(deliverDir, path.basename(f)));
		}
		const slidesDir = path.join(deliverDir, 'slides');
		fs.rmSync(slidesDir, { recursive: true, force: true });
		if (png) {
			// One picture per slide, at its last click, beside the PDF: VS Code's chat shows them as a slide viewer.
			fs.mkdirSync(slidesDir);
			const lastPage = new Map(pages.map((p, i) => [p.slideNo, i]));
			for (const [slideNo, i] of lastPage) {
				fs.copyFileSync(path.join(pngDir, `${String(i + 1).padStart(3, '0')}.png`), path.join(slidesDir, `${String(slideNo).padStart(3, '0')}.png`));
			}
		}
		delivered = deliverDir;
		report.push(`Delivered to ${deliverDir}: ${[...fresh.map(f => path.basename(f)), ...(png ? ['slides/'] : [])].join(', ')}${earlier ? ` (replacing the deck delivered there on ${earlier.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })})` : ''}`);
	}
	fs.writeFileSync(files.checks, report.join('\n') + '\n');
	return { lint, report, files, delivered, pageErrors };
}
