// prs digest: the daily changelog video, one for the top picks of a #changelog report, in the "before → after" design
// (digest/player.js). The agent writes the project; prs digest builds and checks it.
//   prs digest new [--date YYYY-MM-DD | --run id | --file report.md] [--build auto|insiders|main]
//                                                  fetch the report's top picks into videos/changelog-<date>/, and the
//                                                  VS Code build that has them (auto: the installed Insiders, else the
//                                                  newest Insiders build, else VS Code built from main)
//   prs digest check [slug]                        what is missing or wrong (narration cues, marks, strip heights)
//   prs digest stills [slug] --at 3,12.5           single frames + a contact sheet (fast)
//   prs digest review [slug]                       a sheet per chapter of the moments to check, and the checklist
//   prs digest render [slug]                       the whole video, delivered with its captions and a summary
//   prs digest scenes                              the drawn scenes and their params
//
// videos/changelog-<date>/: brief.md (the picks), picks.json, digest.json (the chapters), storyboard.json (the
// narration: beats intro, c1..c5, outro; voiced with prs voice), demos/<id>.mjs (prs demo), scenes/<name>.js (own
// scenes, optional). Build output in build/digest/.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ROOT, buildDir, findFfmpeg, isOffline, loadConfig, readJson, videoDir, writeJson } from './common.mjs';
import { launch } from './browser.mjs';
import { trackBoxAt } from '../../digest/track.js';

const FPS = 30, CLIP_FPS = 30;
const CLIP_W = 1280, CLIP_H = 720;

/** The closest zoom (1 to 2) at which a box of the recording ([x, y, w, h]) still fits the view, with a margin. */
export function fitZoom([, , w, h]) {
	return Math.round(100 * Math.max(1, Math.min(2, 0.85 * CLIP_W / w, 0.85 * CLIP_H / h))) / 100;
}
export const VIEW_H = 675;
const STRIP = { eyebrow: [28, 14], head: [52, 12], row: [66, 10], rowTall: [84, 10], arrow: [40, 10], setting: [84, 0], settingState: [128, 0], settingGap: 16 };
export const TIMING = {
	lead: 0.45, tail: 0.4, clipHold: 0.3, cardTail: 0.6,
	introLead: 0.3, introTail: 0.4, outroLead: 0.35, outroTail: 1.2,
	fade: 0.2, tempo: 1,
};
const TIME_KEY = /^(at|from|until)$|At$/;
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const r3 = x => Math.round(x * 1000) / 1000;

/** The video's timing: MAI-Voice-2 reads a little slower than Kokoro, so it plays a touch faster (1.08, as on Oct 19). */
function digestTiming(timeline, digest) {
	return { ...TIMING, ...(timeline.voice?.provider === 'mai' ? { tempo: 1.08 } : {}), ...(digest.timing ?? {}) };
}

/**
 * The narration of the chapter that shows a demo, as the video plays it (seconds from when the chapter's narration
 * starts): what a demo's cue() waits for. Null before prs voice, or when no chapter shows the demo.
 */
export function demoNarration(slug, demoId) {
	const dfile = path.join(videoDir(slug), 'digest.json'), tfile = path.join(buildDir(slug), 'timeline.json');
	if (!fs.existsSync(dfile) || !fs.existsSync(tfile)) {
		return null;
	}
	const digest = readJson(dfile), timeline = readJson(tfile);
	const chapter = Object.keys(digest.chapters ?? {}).find(id => digest.chapters[id].visual?.demo === demoId);
	const beat = chapter && timeline.beats.find(b => b.id === chapter);
	if (!beat) {
		return null;
	}
	const timing = digestTiming(timeline, digest), tempo = timing.tempo || 1;
	return {
		chapter, tail: timing.tail, end: r3((beat.end - beat.start) / tempo),
		words: beat.words.map(w => ({ display: w.display, a: r3((w.a - beat.start) / tempo), b: r3((w.b - beat.start) / tempo) })),
	};
}

/** The latest digest project (videos/changelog-<date>), or the one named. */
export function digestSlug(arg) {
	if (arg) {
		return arg;
	}
	const dir = path.join(ROOT, 'videos');
	const all = fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => /^changelog-\d{4}-\d{2}-\d{2}$/.test(n)).sort() : [];
	if (!all.length) {
		throw new Error('No digest yet: run prs digest new');
	}
	return all.at(-1);
}

// ---------------------------------------------------------------------------------------------------------------
// prs digest new

/** The picks of a report and the PRs behind them, fetched; the build that has them; the project skeleton. */
export async function newDigest({ run = null, date = null, file = null, build: buildMode = 'auto' } = {}) {
	const { downloadReport, parseReport, topPicks } = await import('./report.mjs');
	const text = file ? fs.readFileSync(file, 'utf8') : (await downloadReport({ run, date })).text;
	const report = parseReport(text);
	if (!report.date) {
		throw new Error(`The report has no date in its heading: ${report.title}`);
	}
	const picks = topPicks(report);
	if (!picks.length) {
		throw new Error('The report has no picks in its main message');
	}
	const slug = `changelog-${report.date}`;
	const dir = videoDir(slug);
	fs.mkdirSync(path.join(dir, 'demos'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'report.md'), text);
	const { downloadPr } = await import('./pr.mjs');
	const { buildInfo } = await import('./demo.mjs');
	let build = null;
	try {
		build = buildInfo();
	} catch {
		build = null;
	}
	const entries = [];
	for (const pick of picks) {
		// A PR fetched before (another day's report named it too) is reused.
		const { ref, data } = await downloadPr(pick.url);
		entries.push({
			rank: pick.rank, flag: pick.flag, warning: pick.warning, number: pick.number, url: pick.url, repo: pick.repo,
			title: pick.title, summary: pick.summary, author: pick.author ?? data.facts.authorLogin, slug: ref.slug,
			mergedAt: data.facts.mergedAt ?? null,
			inBuild: await inBuild(data.facts, build),
			facts: data.facts,
		});
	}
	// The installed Insiders is often a day behind: the newest Insiders build, downloaded, has the picks (and runs signed
	// in like the installed one). The project remembers the build it records.
	let missing = entries.filter(e => e.inBuild === false).length;
	const hasAll = async commit => (await Promise.all(entries.map(e => inBuild(e.facts, { commit })))).every(x => x === true);
	if (missing && buildMode !== 'main' && !isOffline()) {
		try {
			const { newestInsiders } = await import('./build.mjs');
			const exe = await newestInsiders(hasAll);
			if (exe) {
				build = { ...buildInfo(exe), path: exe };
				for (const e of entries) {
					e.inBuild = await inBuild(e.facts, build);
				}
				missing = entries.filter(e => e.inBuild === false).length;
				console.log(`The newest Insiders (${build.version}, ${build.commit?.slice(0, 9)}) has every pick: the demos record it`);
			}
		} catch (error) {
			console.log(`The newest Insiders couldn't be checked or downloaded (${error.message.split('\n')[0]})`);
		}
	}
	// In a release week Insiders is built from the release branch: the picks merged to main are in no Insiders build. Then
	// the demos record VS Code built from main as of the last pick.
	if (buildMode === 'main' || (buildMode === 'auto' && missing)) {
		const last = entries.map(e => e.mergedAt).filter(Boolean).sort().at(-1);
		try {
			const { buildFromSource, cachedBuilds } = await import('./build.mjs');
			console.log(missing ? `${missing} of the ${entries.length} picks are in no Insiders build (a release week): VS Code built from main has them` : 'The demos use VS Code built from main');
			// A build of main done before that has every pick (another day's, a later commit) saves building one.
			let dir = null;
			for (const b of cachedBuilds()) {
				const candidate = { ...buildInfo(b.dir), path: b.dir };
				const has = await Promise.all(entries.map(e => inBuild(e.facts, candidate)));
				if (has.every(x => x === true)) {
					dir = b.dir;
					console.log(`VS Code ${b.version} (${b.commit.slice(0, 9)}), built before, has every pick: ${dir}`);
					break;
				}
			}
			dir ??= await buildFromSource({ at: last ? new Date(Date.parse(last) + 60_000).toISOString() : null });
			build = { ...buildInfo(dir), path: dir };
			for (const e of entries) {
				e.inBuild = await inBuild(e.facts, build);
			}
		} catch (error) {
			console.log(`VS Code couldn't be built from main (${error.message.split('\n')[0]}): the demos use ${build?.name ?? 'no build'}, and picks that aren't in it are drawn`);
		}
	}
	for (const e of entries) {
		delete e.facts;
	}
	writeJson(path.join(dir, 'picks.json'), { date: report.date, title: report.title, build, picks: entries });
	if (!fs.existsSync(path.join(dir, 'digest.json'))) {
		writeJson(path.join(dir, 'digest.json'), skeleton(report.date, entries));
	}
	if (!fs.existsSync(path.join(dir, 'storyboard.json'))) {
		writeJson(path.join(dir, 'storyboard.json'), { pronounce: {}, beats: ['intro', ...entries.map((_, i) => `c${i + 1}`), 'outro'].map(id => ({ id, need: 'digest', say: 'TODO', cues: {}, claims: [] })) });
	}
	writeJson(path.join(dir, 'pr.json'), { facts: {} });
	fs.writeFileSync(path.join(dir, 'brief.md'), brief(report, entries, build));
	return { slug, dir, picks: entries, build };
}

/** Whether the build contains the PR's merge commit (GitHub compare), or null when it can't be told. */
async function inBuild(facts, build) {
	if (!build?.commit || isOffline()) {
		return null;
	}
	try {
		const { api } = await import('./github.mjs');
		const pr = await api(`repos/${facts.repo}/pulls/${facts.number}`);
		if (!pr.merge_commit_sha) {
			return null;
		}
		const cmp = await api(`repos/${facts.repo}/compare/${pr.merge_commit_sha}...${build.commit}`);
		return cmp.status === 'ahead' || cmp.status === 'identical';
	} catch {
		return null;
	}
}

function skeleton(date, picks) {
	return {
		date,
		timing: {},
		chapters: Object.fromEntries(picks.map((p, i) => [`c${i + 1}`, {
			pick: p.rank,
			headline: 'TODO: what changed for users, 4-8 words',
			eyebrow: 'TODO: where it happens (optional)',
			before: { at: 'TODO: a phrase of this chapter\'s narration', rows: [{ id: 'old', text: 'TODO' }] },
			now: { at: 'TODO: the phrase that states the change', rows: [{ id: 'new', text: 'TODO' }] },
			visual: 'TODO: { "demo": "c' + (i + 1) + '" } or { "scene": { "name": "...", "params": { } } } (a card: "name": "card")',
			focus: 'TODO: the part or mark that shows the change (its Now row points to it); remove for a card',
		}])),
	};
}

function brief(report, picks, build) {
	const lines = [
		`# ${report.title}`, '',
		`The top ${picks.length} picks of the #changelog report: one chapter each, in this order. Read each PR's brief before writing its chapter.`,
		build ? `Demos run in ${build.name}${build.version ? ` ${build.version}` : ''}${build.path ? ` (${build.quality === 'main' ? 'built from main' : 'downloaded'}: ${build.path}; prs demo uses it)` : ''} (commit ${build.commit?.slice(0, 10) ?? '?'}).` : 'No VS Code build found: install VS Code Insiders, or set PRS_VSCODE, before recording demos.', '',
	];
	for (const [i, p] of picks.entries()) {
		lines.push(
			`## c${i + 1} · ${p.rank}. ${p.flag ?? ''} #${p.number} ${p.title} (@${p.author})`.replace(/\s+/g, ' ').trim(), '',
			`- The report says: ${p.summary}`,
			`- The PR: ${p.url} · its brief: videos/${p.slug}/brief.md · its diff: videos/${p.slug}/pr.diff · the files it changes, at its head: videos/${p.slug}/build/src/`,
			`- In the demo build: ${p.inBuild === true ? 'yes' : p.inBuild === false ? '**no** (merged after the build: draw it as a scene)' : 'unknown'}`, '',
		);
	}
	lines.push('## The report', '', '```', report.title, '```');
	return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------------------------
// The timeline: segments from the narration, clip timing, time specs resolved to seconds of the video.

/** Absolute time of a phrase in a segment's words. */
export function cueTime(words, phrase, nth = 0, where = '') {
	const want = String(phrase).split(/\s+/).map(norm).filter(Boolean);
	if (!want.length) {
		throw new Error(`Empty cue${where}`);
	}
	let hits = 0;
	for (let i = 0; i + want.length <= words.length; i++) {
		if (want.every((w, j) => norm(words[i + j].display) === w) && hits++ === nth) {
			return words[i].a;
		}
	}
	throw new Error(`Cue "${phrase}"${nth ? ` (#${nth + 1})` : ''} is not in the narration${where}: ${words.map(w => w.display).join(' ')}`);
}

/**
 * A time spec to seconds of the video: a number (seconds into the chapter), a phrase of the chapter's narration, or
 * { cue, nth, offset } | { mark, edge: 'start'|'end', nth, offset } (a demo mark on screen) | { step, offset }.
 */
export function resolveTime(spec, ctx, where = '') {
	if (spec === undefined || spec === null) {
		return undefined;
	}
	if (typeof spec === 'number') {
		return r3(ctx.start + spec);
	}
	if (typeof spec === 'string') {
		return r3(cueTime(ctx.words, spec, 0, where));
	}
	if (typeof spec === 'object') {
		const off = spec.offset ?? 0;
		if (spec.cue !== undefined) {
			return r3(cueTime(ctx.words, spec.cue, spec.nth ?? 0, where) + off);
		}
		if (spec.mark !== undefined) {
			const w = ctx.targets?.[spec.mark]?.windows?.[spec.nth ?? 0];
			if (!w) {
				throw new Error(`Mark "${spec.mark}" is never on screen${where}${ctx.targets ? ` (marks: ${Object.keys(ctx.targets).join(', ')})` : ': this chapter has no demo'}`);
			}
			return r3(w[spec.edge === 'end' ? 1 : 0] + off);
		}
		if (spec.step !== undefined) {
			const s = ctx.steps?.find(x => x.label === spec.step);
			if (!s) {
				throw new Error(`Step "${spec.step}" is not in the demo${where}`);
			}
			return r3(s.at + off);
		}
		if (spec.at !== undefined) {
			return resolveTime(spec.at, ctx, where);
		}
	}
	throw new Error(`Not a time${where}: ${JSON.stringify(spec)} (a phrase, seconds, { cue }, { mark } or { step })`);
}

/** Every time field (at, from, until, *At) of a spec, resolved; the rest copied. */
export function resolveTimes(value, ctx, where = '') {
	if (Array.isArray(value)) {
		return value.map((v, i) => resolveTimes(v, ctx, `${where}[${i}]`));
	}
	if (!value || typeof value !== 'object') {
		return value;
	}
	const out = {};
	for (const [k, v] of Object.entries(value)) {
		out[k] = TIME_KEY.test(k) && (typeof v !== 'object' || v === null || v.cue !== undefined || v.mark !== undefined || v.step !== undefined || v.at !== undefined)
			? resolveTime(v, ctx, `${where}.${k}`)
			: resolveTimes(v, ctx, `${where}.${k}`);
	}
	return out;
}

/** A clip moment (seconds of the recording): a number, { mark, edge, nth, offset } or { step, offset }. */
function clipMoment(spec, demo, where) {
	if (typeof spec === 'number') {
		return spec;
	}
	if (spec?.mark !== undefined) {
		const w = demo.marks[spec.mark]?.visible?.[spec.nth ?? 0];
		if (!w) {
			throw new Error(`Mark "${spec.mark}" is never visible in demo ${demo.id}${where}`);
		}
		return w[spec.edge === 'end' ? 1 : 0] + (spec.offset ?? 0);
	}
	if (spec?.step !== undefined) {
		const s = demo.steps.find(x => x.label === spec.step);
		if (!s) {
			throw new Error(`Step "${spec.step}" is not in demo ${demo.id}${where}`);
		}
		return s.t + (spec.offset ?? 0);
	}
	throw new Error(`Not a moment of the recording${where}: ${JSON.stringify(spec)}`);
}

/** Strip height in pixels (it must fit the view: 675). */
export function stripHeight(ch) {
	let h = 0;
	const add = ([a, b]) => {
		h += a + b;
	};
	if (ch.eyebrow) {
		add(STRIP.eyebrow);
	}
	if (ch.before) {
		add(STRIP.head);
		for (const r of ch.before.rows ?? []) {
			add(r.sub || r.tone === 'orange' ? STRIP.rowTall : STRIP.row);
		}
		add(STRIP.arrow);
	}
	add(STRIP.head);
	for (const r of ch.now?.rows ?? []) {
		add(r.sub || r.tone === 'orange' ? STRIP.rowTall : STRIP.row);
	}
	if (ch.setting) {
		h += STRIP.settingGap;
		add(ch.setting.state ? STRIP.settingState : STRIP.setting);
	}
	return h;
}

function prettyDate(date) {
	const d = new Date(`${date}T12:00:00Z`);
	return {
		long: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
		short: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
	};
}

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];

/** DATA for the page: segments with resolved chapter specs, clip timing, marks in video time; the audio plan. */
/** When each strip row has fully come in (seconds of the video), as the player shows it. */
/**
 * The strip comes in top to bottom: Before (its head, then its rows), its arrow, Now (its head, then its rows), then the
 * setting card. When the narration names the old state after the new one ("now X, instead of Y"), Before comes in just
 * ahead of Now, not after it; Now's rows and the setting come in after Now's head and in order.
 */
export function orderStrip(spec) {
	const n = spec.now, b = spec.before;
	let last = n.at;
	n.rows.forEach((r, i) => {
		last = r.at = r.at === undefined ? Math.max(last, n.at + 0.12 * i) : Math.max(r.at, last);
	});
	if (spec.setting?.at !== undefined) {
		spec.setting.at = Math.max(spec.setting.at, last + 0.2);
	}
	if (b?.rows?.length && b.at !== undefined) {
		b.at = Math.min(b.at, n.at - 0.6 - 0.12 * (b.rows.length - 1));
		let prev = b.at;
		b.rows.forEach((r, i) => {
			prev = r.at = Math.min(n.at - 0.45, r.at === undefined ? b.at + 0.15 + 0.12 * i : Math.max(r.at, prev));
		});
	}
	return spec;
}

export function rowTimes(spec) {
	const out = {};
	(spec.before?.rows ?? []).forEach((r, i) => {
		out[r.id] = (r.at ?? spec.before.at + 0.15 + 0.12 * i) + 0.6;
	});
	(spec.now?.rows ?? []).forEach((r, i) => {
		out[r.id] = (r.at ?? spec.now.at + 0.12 * i) + 0.6;
	});
	return out;
}

/** The Now row an arrow starts from by default: the first one that is a change (green), or the first. */
export function defaultFocusRow(spec) {
	const rows = spec.now?.rows ?? [];
	return (rows.find(r => (r.tone ?? (r.changed === false ? undefined : 'green')) === 'green') ?? rows[0])?.id;
}

/**
 * A chapter's arrows, as a list: `"focus": "row"` is one arrow (from `focusRow`, or the first green Now row);
 * `"focus": [{ "part": "row", "row": "new", "at": "a phrase" }, ...]` is up to three, one after another.
 */
export function focusEntries(spec) {
	const list = spec.focus === undefined || spec.focus === null || spec.focus === '' ? [] : [].concat(spec.focus);
	return list.map((e, i) => typeof e === 'string'
		? { part: e, row: i === 0 ? spec.focusRow : undefined }
		: { part: e?.part, row: e?.row, at: e?.at });
}

/** An arrow's color: its row's tone (orange for a warning, blue for a button, grey from a Before row, else green). */
export function rowTone(spec, rowId) {
	if ((spec.before?.rows ?? []).some(r => r.id === rowId)) {
		return 'neutral';
	}
	const row = (spec.now?.rows ?? []).find(r => r.id === rowId);
	if (!row) {
		return 'green';
	}
	if (row.tone === 'orange' || row.tone === 'blue') {
		return row.tone;
	}
	return row.style === 'button' ? 'blue' : 'green';
}

/**
 * When a part an arrow points to is on screen and steady, in seconds of the video: [[from, until, steady (seconds of
 * the recording, demos)]], or a problem. A demo's mark: as recorded, still for 0.3 s (with `proof`: only while it
 * shows it); a scene's part: as the scene draws it.
 */
function targetWindows(id, name, spec, { start, end, kit, demo, recording }, proofs = []) {
	if (demo) {
		const m = recording.marks[name];
		if (!m?.rect) {
			return { problem: `${id}: the focus "${name}" is not a mark of the demo, or never on screen (marks: ${Object.keys(recording.marks).join(', ') || 'none'})` };
		}
		if (m.rect[2] * m.rect[3] > 0.4 * CLIP_W * CLIP_H) {
			return { problem: `${id}: the focus "${name}" is most of the window (${m.rect.slice(2).map(Math.round).join('x')}): a ring around it says nothing. Mark the UI that shows the change (the setting's row, the dialog, the button)` };
		}
		const windows = [];
		m.visible.forEach(([ca, cb], i) => {
			// Shown only after the recording's end: not in any frame of the video.
			if (ca >= recording.cEnd || proofs.length && !proofs.every(p => proofText(m.texts?.[i] ?? '').includes(p))) {
				return;
			}
			const steady = steadyFrom(m.track, ca, cb);
			if (steady !== null) {
				// To the chapter's end only when it was still seen at the recording's end.
				windows.push([recording.toVideo(steady), cb >= recording.cEnd - 0.005 ? end : recording.toVideo(cb), steady]);
			}
		});
		if (!windows.length) {
			return {
				problem: proofs.length
					? `${id}: the focus "${name}" never stays still on screen while it shows the proof: look at the demo's contact sheet`
					: `${id}: the focus "${name}" never stays still on screen`,
			};
		}
		return { windows };
	}
	const kind = kit[spec.scene?.name];
	if (!kind) {
		return { problem: `${id}: there is no scene "${spec.scene?.name}"` };
	}
	if (spec.scene.name === 'card') {
		return { problem: `${id}: a card has nothing to point at: no focus` };
	}
	const parts = kind.windows(spec.scene.params ?? {}, { start, end });
	if (!parts[name]) {
		return { problem: `${id}: the ${spec.scene.name} scene doesn't draw "${name}" with these params (it draws: ${Object.keys(parts).join(', ')})` };
	}
	return { windows: [parts[name]] };
}

/**
 * A chapter's arrows, computed (up to three, one at a time): each from its row (once the row is in, and once its
 * phrase is spoken: `at`) to its target, while the target is on screen and steady, until the next one starts or its
 * target leaves. Each lasts at least 1 s, or there are none (focusProblem says why). For a demo, the camera moves in
 * on the parts pointed at when the first shows (as close as they fit, at most 1.5x), and on to a later one out of view.
 */
export function planFocus(id, spec, ctx) {
	const { start, end, demo, recording } = ctx;
	const out = { focus: [], focusProblem: null, camera: [] };
	const entries = focusEntries(spec);
	if (!entries.length) {
		return out;
	}
	const fail = problem => ({ focus: [], focusProblem: problem, camera: [] });
	if (entries.length > 3) {
		return fail(`${id}: ${entries.length} arrows: at most 3 (one at a time)`);
	}
	const fmt = x => (x - start).toFixed(1);
	const times = rowTimes(spec);
	// The proof (the PR's text a demo shows) is shown by one of the marks: its windows count only while it shows it.
	const proofs = [].concat(spec.proof ?? []).map(proofText).filter(Boolean);
	const showsProof = name => (recording?.marks?.[name]?.texts ?? []).some(t => proofs.every(p => proofText(t).includes(p)));
	const proofEntry = demo && proofs.length ? Math.max(0, entries.findIndex(e => showsProof(e.part))) : -1;
	const plans = [];
	for (const [i, e] of entries.entries()) {
		if (!e.part) {
			return fail(`${id}: arrow ${i + 1} has no "part" (the mark or scene part it points to)`);
		}
		const row = e.row ?? defaultFocusRow(spec);
		if (times[row] === undefined) {
			return fail(`${id}: ${i === 0 && !Array.isArray(spec.focus) ? 'focusRow' : `the row of arrow ${i + 1},`} "${row}" is not a row of the strip`);
		}
		const target = targetWindows(id, e.part, spec, ctx, i === proofEntry ? proofs : []);
		if (target.problem) {
			return fail(target.problem);
		}
		plans.push({ name: e.part, row, rowIn: times[row], at: typeof e.at === 'number' ? e.at : null, windows: target.windows, tone: rowTone(spec, row) });
	}
	// The camera (demos) frames the marks pointed at, as they are once steady: as close as the first ones fit together
	// (at most 1.5x), when the first one shows. When a later one is out of that view, it moves to frame it with the one
	// before (or the whole window), once the arrow before has had its second; the arrows wait for it to settle.
	const boxes = demo ? plans.map(p => trackBoxAt(recording.marks[p.name], p.windows[0][2]) ?? recording.marks[p.name].rect) : [];
	const framing = list => {
		const x0 = Math.min(...list.map(b => b[0])), y0 = Math.min(...list.map(b => b[1]));
		const x1 = Math.max(...list.map(b => b[0] + b[2])), y1 = Math.max(...list.map(b => b[1] + b[3]));
		const z = Math.min(1.5, 0.85 * CLIP_W / (x1 - x0), 0.85 * CLIP_H / (y1 - y0));
		return z >= 1.1 ? { z: r3(z), fx: r3((x0 + x1) / 2), fy: r3((y0 + y1) / 2) } : { z: 1, fx: CLIP_W / 2, fy: CLIP_H / 2 };
	};
	const inView = (b, v) => {
		// A view at the window's edge shows what touches it: the margin is only on the sides inside the window.
		const w = CLIP_W / v.z, h = CLIP_H / v.z;
		const left = Math.min(Math.max(v.fx - w / 2, 0), CLIP_W - w), top = Math.min(Math.max(v.fy - h / 2, 0), CLIP_H - h);
		const mx = 0.04 * w, my = 0.04 * h;
		return b[0] >= (left > 0 ? left + mx : 0) && b[0] + b[2] <= (left + w < CLIP_W ? left + w - mx : CLIP_W)
			&& b[1] >= (top > 0 ? top + my : 0) && b[1] + b[3] <= (top + h < CLIP_H ? top + h - my : CLIP_H);
	};
	const views = [];
	if (demo) {
		let first = 1;
		while (first < boxes.length && framing(boxes.slice(0, first + 1)).z >= Math.max(1.1, 0.85 * framing(boxes.slice(0, first)).z)) {
			first++;
		}
		const view0 = framing(boxes.slice(0, first));
		for (let i = 0; i < boxes.length; i++) {
			const view = i ? views[i - 1] : view0;
			views.push(i < first || inView(boxes[i], view) ? view : framing([boxes[i - 1], boxes[i]]));
		}
	}
	// One at a time, in order: each starts once its row is in, its phrase is spoken, its target is steady (0.25 s), the
	// camera has settled, and the one before has had 1 s; it ends when the next starts (or the camera moves on), or
	// when its target leaves.
	const starts = [];
	let settle = -Infinity;
	for (const [i, p] of plans.entries()) {
		const moves = demo && (i === 0 ? views[0].z > 1 : views[i] !== views[i - 1]);
		let chosen = null;
		for (const w of p.windows) {
			let camAt = null, ready = settle;
			if (moves) {
				camAt = r3(i === 0 ? Math.max(start + 0.2, w[0] - 0.1) : Math.max(starts[i - 1].from + 1.05, Math.min(w[0] - 0.1, starts[i - 1].until)));
				ready = camAt + 0.9 + 0.05;
			}
			const earliest = Math.max(p.rowIn, p.at ?? -Infinity, ready, i ? starts[i - 1].from + 1 : -Infinity);
			if (Math.min(w[1], end) - Math.max(earliest, w[0] + 0.25) >= 1) {
				chosen = { w, earliest, camAt, ready };
				break;
			}
		}
		if (!chosen) {
			const earliest = Math.max(p.rowIn, p.at ?? -Infinity, settle, i ? starts[i - 1].from + 1 : -Infinity);
			const shown = p.windows.map(([a, b]) => `${fmt(a)}-${fmt(Math.min(b, end))} s`).join(', ');
			return fail(i === 0 && plans.length === 1 && p.at === null
				? `${id}: "${p.name}" is on screen (and steady) ${shown} into the chapter, but its row "${p.row}" is in only at ${fmt(p.rowIn)} s: the arrow would last under 1 s. Show it longer (or later, clip.start/end), or bring the row in earlier`
				: `${id}: arrow ${i + 1} ("${p.row}" → "${p.name}") can start only at ${fmt(earliest)} s into the chapter (its row, its phrase${i ? ', the arrow before' : ''}${moves && i ? ', the camera moving to it' : ''}), but "${p.name}" is on screen (and steady) ${shown}: it would last under 1 s. Show it longer, or bring its row or phrase earlier`);
		}
		if (chosen.camAt !== null) {
			out.camera.push({ at: chosen.camAt, dur: 0.9, ...views[i] });
			settle = chosen.ready;
			if (i) {
				starts[i - 1].until = Math.min(starts[i - 1].until, chosen.camAt - 0.05);
			}
		}
		starts.push({ from: Math.max(chosen.earliest, chosen.w[0] + 0.25), until: Math.min(chosen.w[1], end) });
	}
	for (const [i, p] of plans.entries()) {
		const until = i + 1 < plans.length ? Math.min(starts[i].until, starts[i + 1].from - 0.05) : starts[i].until;
		if (until - starts[i].from < 1) {
			return fail(`${id}: arrow ${i + 1} ("${p.row}" → "${p.name}") would last ${(until - starts[i].from).toFixed(1)} s before arrow ${i + 2}: at least 1 s each. Give it more time (a later phrase for the next)`);
		}
		out.focus.push({ name: p.name, row: p.row, from: r3(starts[i].from), until: r3(until), tone: p.tone });
	}
	return out;
}

/** Where a demo's part shown starts by default: 1.2 s before its focus first shows (with the proof), or 0. */
export function focusShows(demo, ch) {
	const proofs = [].concat(ch.proof ?? []).map(proofText).filter(Boolean);
	const names = focusEntries(ch).map(e => e.part).filter(Boolean);
	let first = Infinity;
	for (const name of names) {
		const m = demo.marks?.[name];
		const i = (m?.visible ?? []).findIndex((_, k) => proofs.every(p => proofText(m.texts?.[k] ?? '').includes(p)));
		if (i >= 0) {
			first = Math.min(first, m.visible[i][0]);
			break;
		}
	}
	return first === Infinity ? 0 : Math.max(0, +(first - 1.2).toFixed(2));
}

/** The first moment (seconds of the recording) in [a, b] when a tracked mark has been still for 0.3 s, or null. */
export function steadyFrom(track, a, b) {
	const samples = (track ?? []).filter(s => s[0] >= a - 0.01 && s[0] <= b + 0.01);
	for (let i = 0; i < samples.length; i++) {
		const [t, x, y, w, h] = samples[i];
		const recent = samples.filter(s => s[0] >= t - 0.3 && s[0] <= t);
		const still = recent.every(s => Math.abs(s[1] + s[3] / 2 - (x + w / 2)) < 4 && Math.abs(s[2] + s[4] / 2 - (y + h / 2)) < 4 && Math.abs(s[3] - w) < 4 && Math.abs(s[4] - h) < 4);
		if (still && (t - recent[0][0] >= 0.2 || t - a >= 0.2 && recent.length >= 2)) {
			return t;
		}
	}
	return null;
}

/**
 * A recording's marks with each window ending where its mark was last seen. Recordings made before the engine logged
 * it so end where the mark was first missed, up to a tenth of a second after it closed: a ring held to that moment
 * can be on nothing. A window that lasts to the recording's end stays as it is.
 */
export function seenWindows(demo) {
	for (const m of Object.values(demo.marks ?? {})) {
		const seen = (m.track ?? []).map(s => s[0]);
		m.visible = (m.visible ?? []).map(([a, b]) => {
			const last = b >= demo.duration - 0.01 ? b : seen.filter(t => t >= a - 0.005 && t <= b + 0.005).at(-1);
			return [a, last ?? b];
		});
	}
	return demo;
}

function readDemo(file) {
	return seenWindows(readJson(file));
}

export async function planDigest(slug) {
	const kit = await loadSceneDocs();
	const dir = videoDir(slug), bdir = buildDir(slug);
	const digest = readJson(path.join(dir, 'digest.json'));
	const picksDoc = readJson(path.join(dir, 'picks.json'));
	const tlFile = path.join(bdir, 'timeline.json');
	if (!fs.existsSync(tlFile)) {
		throw new Error(`No narration yet: write storyboard.json, then run prs voice ${slug}`);
	}
	const timeline = readJson(tlFile);
	const timing = digestTiming(timeline, digest);
	const tempo = timing.tempo || 1;
	const picks = new Map(picksDoc.picks.map(p => [p.rank, p]));
	const segments = [], words = [], audio = [];
	let at = 0, anyDemo = false;
	for (const beat of timeline.beats) {
		const kind = beat.id === 'intro' ? 'intro' : beat.id === 'outro' ? 'outro' : 'chapter';
		const lead = kind === 'chapter' ? timing.lead : kind === 'intro' ? timing.introLead : timing.outroLead;
		const narr = (beat.end - beat.start) / tempo;
		const segWords = beat.words.map(w => ({ a: r3(at + lead + (w.a - beat.start) / tempo), b: r3(at + lead + (w.b - beat.start) / tempo), display: w.display, seg: beat.id }));
		const where = ` (${beat.id})`;
		const seg = { id: beat.id, kind, start: r3(at), lead };
		let dur;
		if (kind === 'chapter') {
			const ch = digest.chapters?.[beat.id];
			if (!ch) {
				throw new Error(`digest.json has no chapter ${beat.id}`);
			}
			const pick = picks.get(ch.pick) ?? picksDoc.picks[Number(beat.id.slice(1)) - 1];
			const ctx = { start: at, words: segWords };
			const visual = ch.visual ?? {};
			let targets = {}, steps = [], recording = null;
			if (visual.demo) {
				anyDemo = true;
				const ddir = path.join(bdir, 'demos', visual.demo);
				const demoFile = path.join(ddir, 'demo.json');
				if (!fs.existsSync(demoFile)) {
					throw new Error(`Demo "${visual.demo}" is not recorded${where}: run prs demo ${visual.demo}`);
				}
				const demo = readDemo(demoFile);
				const clipSpec = ch.clip ?? {};
				// A demo paced by cue() plays as recorded (1x): its narration starts where it called begin() (or where the
				// recording starts), and the clip ends where its script ends. Recorded for other words, it's out of sync.
				const sync = demo.sync?.chapter === beat.id && clipSpec.start === undefined ? demo.sync : null;
				for (const c of sync?.cues ?? []) {
					let t = null;
					try {
						t = cueTime(segWords, c.phrase, c.nth ?? 0) - at - lead;
					} catch {
						// No longer said: reported below.
					}
					if (t === null || Math.abs(t - c.t) > 0.15) {
						throw new Error(`${beat.id}: the narration changed since demo ${visual.demo} was recorded ("${c.phrase}" ${t === null ? 'is no longer in it' : `moved from ${c.t.toFixed(2)} s to ${t.toFixed(2)} s`}): record it again (prs demo ${visual.demo})`);
					}
				}
				// The part of the recording shown: clip.start to clip.end (seconds, or a moment such as when a mark shows).
				// By default it starts 1.2 s before the focus first shows (with the proof): not on how the demo got there.
				const cStart = clipSpec.start !== undefined ? clipMoment(clipSpec.start, demo, `${where}.clip.start`) : sync ? sync.at : focusShows(demo, ch);
				const cEnd = Math.min(clipSpec.end !== undefined ? clipMoment(clipSpec.end, demo, `${where}.clip.end`) : sync?.end ?? demo.duration, demo.count / CLIP_FPS);
				if (cEnd - cStart < 1) {
					throw new Error(`${beat.id}: the part of the recording shown is ${(cEnd - cStart).toFixed(1)} s (clip.start/end): at least 1 s`);
				}
				// One steady speed: the recording fits the narration (up to twice as fast), then holds its last frame.
				const rate = sync ? 1 : Math.min(2, Math.max(1, (cEnd - cStart) / Math.max(1, narr + timing.tail - 0.2)));
				const vEnd = lead + (cEnd - cStart) / rate;
				dur = Math.max(lead + narr + timing.tail, vEnd + timing.clipHold);
				const clipAt = v => v <= lead ? cStart : Math.min(cEnd, cStart + (v - lead) * rate);
				const inv = c => lead + (Math.min(cEnd, Math.max(cStart, c)) - cStart) / rate;
				const n = Math.ceil(dur * FPS) + 1;
				seg.clip = {
					dir: pathToFileURL(path.join(ddir, 'frames')).href, fps: FPS, clipFps: CLIP_FPS, rate: r3(rate),
					map: Array.from({ length: n }, (_, k) => Math.max(1, Math.min(demo.count, Math.round(clipAt(k / FPS) * CLIP_FPS) + 1))),
				};
				for (const [name, m] of Object.entries(demo.marks)) {
					if (!m.rect) {
						continue;
					}
					// When it is on screen in the video (the hold on the last frame included), and where it is in each frame
					// of the recording (the player looks its box up at the frame it shows).
					// Through the hold only when it was still seen at the recording's end: a ring never stays on what closed.
					const windows = m.visible
						.filter(([a, b]) => Math.min(b, cEnd) - Math.max(a, cStart) > 0.05)
						.map(([a, b]) => [r3(at + inv(a)), r3(at + (b >= cEnd - 0.005 ? dur : inv(b)))]);
					targets[name] = { rect: m.rect, windows, visible: m.visible, track: m.track ?? [], text: m.text ?? '' };
				}
				steps = demo.steps.map(s => ({ label: s.label, at: r3(at + inv(s.t)) }));
				recording = { toVideo: c => at + inv(c), cEnd, marks: demo.marks };
			} else if (visual.scene) {
				dur = lead + narr + timing.cardTail;
			} else {
				throw new Error(`${beat.id}: visual must be { "demo": id } or { "scene": { name, params } }`);
			}
			seg.end = r3(at + dur);
			const full = { start: at, end: at + dur, words: segWords, targets, steps };
			const { clip, visual: _v, pick: _p, links: _l, camera: _c, ...rest } = ch;
			const spec = resolveTimes(rest, full, where);
			if (visual.scene) {
				spec.scene = { name: visual.scene.name, params: resolveTimes(visual.scene.params ?? {}, full, `${where}.visual.scene.params`) };
			}
			if (!spec.now?.rows?.length || spec.now.at === undefined) {
				throw new Error(`${beat.id}: "now" needs "at" (the phrase that states the change) and rows`);
			}
			orderStrip(spec);
			Object.assign(seg, planFocus(beat.id, spec, { start: at, end: at + dur, targets, kit, demo: visual.demo ? targets : null, clip: seg.clip, recording }));
			const changed = spec.now.rows.filter(r => r.changed !== false && r.tone !== 'orange');
			spec.recap = spec.recap ?? { before: spec.before?.rows?.[0]?.text ?? null, now: (changed.length ? changed : spec.now.rows).map(r => r.text).join(' · '), mono: (changed[0] ?? spec.now.rows[0]).mono ?? false };
			Object.assign(spec, { rank: pick.rank, number: pick.number, author: pick.author, url: pick.url, flag: pick.flag });
			seg.spec = spec;
			seg.targets = targets;
		} else {
			dur = lead + narr + (kind === 'outro' ? timing.outroTail : timing.introTail);
			seg.end = r3(at + dur);
		}
		segments.push(seg);
		words.push(...segWords);
		audio.push({ from: beat.start - 0.04, to: beat.end + 0.3, at: at + lead - 0.04 / tempo });
		at += dur;
	}
	const { long, short } = prettyDate(digest.date ?? picksDoc.date);
	const build = picksDoc.build;
	// Named as people say it: "VS Code Insiders", with its release (1.143) where the video credits the recordings.
	const product = build && /insider/i.test(`${build.quality ?? ''} ${build.name ?? ''}`) ? 'VS Code Insiders' : 'VS Code';
	const release = build?.version?.match(/^\d+\.\d+/)?.[0];
	const n = segments.filter(s => s.kind === 'chapter').length;
	const meta = {
		title: 'VS Code Changelog', date: long, dateShort: short,
		subtitle: `the top ${NUMBERS[n] ?? n} changes merged in the last day`,
		build: product, channel: '#changelog',
		made: anyDemo ? `Demos recorded in ${product}${release ? ` ${release}` : ''} · made with changelog-videos` : 'Made with changelog-videos',
		...(digest.meta ?? {}),
	};
	return { data: { meta, fps: FPS, total: r3(at), timing, segments, words }, audio, tempo };
}

// ---------------------------------------------------------------------------------------------------------------
// Proofs: what a chapter shows must be the PR's own text

/** Text as compared for proofs: case, spacing, mnemonics (&&), Markdown markers, links and escapes, and codicons don't count. */
export function proofText(text) {
	return String(text ?? '').toLowerCase()
		.replace(/&&/g, '')
		.replace(/[\u2018\u2019]/g, '\'').replace(/[\u201c\u201d]/g, '"')
		.replace(/\\[nrt]/g, ' ')
		.replace(/\$\([\w~-]+\)/g, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[`*\\]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A PR's text, as compared for proofs: its strings with placeholders ({0}) match any value shown in their place. */
export function proofCorpus(raw) {
	const templates = [];
	for (const m of raw.matchAll(/"((?:[^"\\\n]|\\.)*\{\d+\}(?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*\{\d+\}(?:[^'\\\n]|\\.)*)'/g)) {
		const parts = proofText(m[1] ?? m[2]).split(/\{\d+\}/);
		if (parts.join('').trim().length >= 6) {
			templates.push(new RegExp(`^${parts.map(escapeRegExp).join('.+?')}$`));
		}
	}
	return { text: proofText(raw), templates };
}

/**
 * Whether a string is the PR's: in its text, or one of its strings with values in place of the placeholders. A
 * shortcut VS Code adds to a label ("New Chat (⌘T)", "Run (Ctrl+Enter)") is not part of it.
 */
export function inProof(corpus, text) {
	const t = proofText(text).replace(/\s*\((?:[⌘⌥⇧⌃]|(?:ctrl|cmd|alt|shift|meta|option)\+)[^)]*\)$/, '');
	return t.length > 0 && (corpus.text.includes(t) || corpus.templates.some(re => re.test(t)));
}

/** Everything a PR says: its title, its description, its diff and the files it changes, at its head (downloaded). */
function prCorpus(prSlug, cache) {
	if (!cache.has(prSlug)) {
		const dir = videoDir(prSlug);
		const pr = readJson(path.join(dir, 'pr.json'));
		const parts = [pr.facts?.title ?? '', pr.body ?? ''];
		if (fs.existsSync(path.join(dir, 'pr.diff'))) {
			parts.push(fs.readFileSync(path.join(dir, 'pr.diff'), 'utf8'));
		}
		const walk = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
		for (const f of walk(path.join(buildDir(prSlug), 'src', pr.facts?.headSha9 ?? '-'))) {
			if (fs.statSync(f).size < 4_000_000) {
				parts.push(fs.readFileSync(f, 'utf8'));
			}
		}
		cache.set(prSlug, proofCorpus(parts.join('\n')));
	}
	return cache.get(prSlug);
}

/**
 * The parts of a demo chapter's Now rows (split at · and ,) that are the PR's text but that no mark of the recording
 * shows: the strip would say one thing and the recording another (a build newer than the PR can word it differently).
 */
export function unshownParts(ch, demo, corpus) {
	const seen = proofText(Object.values(demo.marks ?? {}).flatMap(m => [...(m.texts ?? []), m.text ?? '']).join('\n'));
	return (ch.now?.rows ?? []).flatMap(r => [r.text, r.sub]).filter(Boolean)
		.flatMap(t => String(t).split(/\s*[·,]\s*/))
		.filter(part => proofText(part).length >= 3 && inProof(corpus, part) && !seen.includes(proofText(part)));
}

/**
 * What is wrong with a demo of a removal, or null: `text` must be what the PR's diff takes out (on a removed line, and
 * on no added one: a rename is not a removal), and no mark of the recording may show it (what the demo typed aside).
 */
export function removalProblem(text, diff, demo) {
	const t = proofText(text);
	if (t.length < 6) {
		return `"${text}" is too short to name what was removed: 6 characters or more`;
	}
	const lines = String(diff ?? '').split('\n');
	const side = sign => proofText(lines.filter(l => l.startsWith(sign) && !l.startsWith(sign.repeat(3))).map(l => l.slice(1)).join('\n'));
	if (!side('-').includes(t)) {
		return `"${text}" is not text the PR's diff removes`;
	}
	if (side('+').includes(t)) {
		return `the PR's diff adds "${text}" too: a rename or a move is not a removal (prove the new name with "proof")`;
	}
	let shown = proofText(Object.values(demo?.marks ?? {}).flatMap(m => [...(m.texts ?? []), m.text ?? '']).join('\n'));
	for (const typed of demo?.typed ?? []) {
		shown = shown.split(proofText(typed)).join(' ');
	}
	return shown.includes(t) ? `the recording still shows "${text}": a removal shows where it was, now without it` : null;
}

/** A PR's diff, or null when it wasn't downloaded. */
function prDiff(prSlug) {
	const file = path.join(videoDir(prSlug), 'pr.diff');
	return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

/**
 * Whether a diff adds or changes a setting's default: an added `default: <value>` property (not a switch's `default:`
 * case), or a default kept in a constant or function (`FOO_DEFAULT = true`, `enabledByDefault = …`,
 * `function isOnByDefault(`).
 */
export function changesADefault(diff) {
	return diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1)).some(l =>
		/^\s*["']?default["']?\s*:\s*(?!return\b|break\b|throw\b|continue\b)[^\s;{][^;{]*$/.test(l)
		|| /\b(?:[A-Z0-9_]*DEFAULT[A-Z0-9_]*|\w+Default)\s*=(?![=>])/.test(l)
		|| /\bfunction\s+\w+Default\s*\(/.test(l));
}

/**
 * What a chapter shows a value changing with: a toggle that flips, Before and Now toggles that differ, a drawn setting
 * whose value flips. Each says a default changed.
 */
export function valueChanges(ch, kit) {
	const out = [];
	const before = ch.before?.rows ?? [], now = ch.now?.rows ?? [];
	for (const r of [...before, ...now].filter(r => r.toggle === 'flip')) {
		out.push(`the row "${r.text}" flips its toggle`);
	}
	if (ch.setting?.toggle === 'flip') {
		out.push('the setting card flips its toggle');
	}
	const states = rows => new Set(rows.map(r => r.toggle).filter(t => t === 'on' || t === 'off'));
	const was = states(before), is = states(now);
	if (was.size && [...is].some(s => !was.has(s))) {
		out.push('its Before and Now toggles differ');
	}
	const scene = ch.visual?.scene;
	if (scene && kit[scene.name]?.changesDefault?.(scene.params ?? {})) {
		out.push(`the ${scene.name} scene changes the value (before → after)`);
	}
	return out;
}

// ---------------------------------------------------------------------------------------------------------------
// prs digest check

export async function checkDigest(slug) {
	const dir = videoDir(slug), bdir = buildDir(slug);
	const problems = [], notes = [];
	const digest = readJson(path.join(dir, 'digest.json'));
	const storyboard = readJson(path.join(dir, 'storyboard.json'));
	const picks = readJson(path.join(dir, 'picks.json')).picks;
	const ids = picks.map((_, i) => `c${i + 1}`);
	for (const b of storyboard.beats) {
		if (!b.say || /TODO/.test(b.say)) {
			problems.push(`storyboard.json: beat ${b.id} has no narration yet`);
		}
	}
	const words = storyboard.beats.reduce((n, b) => n + String(b.say ?? '').split(/\s+/).filter(Boolean).length, 0);
	notes.push(`narration: ${words} words (about 150 make a 55-60 s video)`);
	if (words > 175) {
		problems.push(`the narration has ${words} words: cut it to about 150 (the video should run under a minute)`);
	}
	const kit = await loadSceneDocs();
	const icons = new Set([...(await sceneKit()).ICON_NAMES, 'github']);
	const corpora = new Map();
	for (const [i, id] of ids.entries()) {
		const ch = digest.chapters?.[id];
		if (!ch) {
			problems.push(`digest.json: no chapter ${id}`);
			continue;
		}
		const pick = picks.find(p => p.rank === ch.pick) ?? picks[i];
		let corpus = null;
		try {
			corpus = prCorpus(pick.slug, corpora);
		} catch (error) {
			problems.push(`${id}: can't read #${pick.number} to check what the chapter shows (${error.message.split('\n')[0]})`);
		}
		const isPr = text => !corpus || inProof(corpus, text);
		for (const name of new Set(iconsOf({ before: ch.before, now: ch.now, visual: ch.visual }))) {
			if (!icons.has(name)) {
				problems.push(`${id}: there is no icon "${name}" (prs digest scenes lists the icons)`);
			}
		}
		const where = `#${pick.number} (its diff, the files it changes, its title or description)`;
		if (ch.setting?.name && !isPr(ch.setting.name)) {
			problems.push(`${id}: the setting "${ch.setting.name}" is not in ${where}`);
		}
		// The arrow is computed (focus): the agent doesn't draw arrows, move the camera or time the recording.
		for (const [field, instead] of [['links', '"focus": the one target its Now row points to (the arrow is drawn when both are on screen)'], ['camera', 'nothing: the camera moves in on the focus by itself'], ['clip.anchors', 'clip.start/clip.end to trim; the recording plays at one steady speed'], ['clip.after', 'nothing: the recording plays at one steady speed']]) {
			const [a, b] = field.split('.');
			if (b ? ch[a]?.[b] !== undefined : ch[a] !== undefined) {
				problems.push(`${id}: "${field}" is gone: use ${instead}`);
			}
		}
		const rowIds = new Set([...(ch.before?.rows ?? []), ...(ch.now?.rows ?? [])].map(r => r.id));
		const entries = focusEntries(ch);
		if (ch.focusRow && !(ch.now?.rows ?? []).some(r => r.id === ch.focusRow)) {
			problems.push(`${id}: focusRow "${ch.focusRow}" is not a Now row (rows: ${[...rowIds].join(', ')})`);
		}
		if (entries.length > 3) {
			problems.push(`${id}: ${entries.length} arrows: at most 3 (one at a time)`);
		}
		for (const [i, e] of entries.entries()) {
			if (typeof e.part !== 'string' || !e.part) {
				problems.push(`${id}: arrow ${i + 1} needs "part": the mark or scene part it points to`);
			}
			if (e.row !== undefined && !rowIds.has(e.row)) {
				problems.push(`${id}: arrow ${i + 1} starts from row "${e.row}", which is not a row of the strip (rows: ${[...rowIds].join(', ')})`);
			}
		}
		const scene = ch.visual?.scene;
		if (scene) {
			const kind = kit[scene.name];
			if (!kind) {
				problems.push(`${id}: there is no scene "${scene.name}" (scenes: ${Object.keys(kit).join(', ')})`);
			} else {
				for (const key of Object.keys(scene.params ?? {})) {
					if (!(key in kind.params)) {
						problems.push(`${id}: the ${scene.name} scene has no "${key}" (it draws only what its params say: ${Object.keys(kind.params).join(', ')})`);
					}
				}
				if (entries.length && scene.name === 'card') {
					problems.push(`${id}: a card has nothing to point at: remove "focus"`);
				} else {
					for (const e of entries.filter(x => x.part && !kind.targets.includes(x.part))) {
						problems.push(`${id}: "${e.part}" is not a part of the ${scene.name} scene (parts: ${kind.targets.join(', ')})`);
					}
				}
				// A drawn UI shows the PR's own strings: a scene drawn with made-up text would show a UI that doesn't exist.
				for (const proof of kind.proofs(scene.params ?? {})) {
					if (!proof.text) {
						problems.push(`${id}: the ${scene.name} scene needs ${proof.param}: the PR's own text (or show the change on a card)`);
					} else if (!isPr(proof.text)) {
						problems.push(`${id}: "${proof.text}" (${scene.name}, ${proof.param}) is not in ${where}: draw only the PR's own strings, or show the change on a card`);
					}
				}
				// A value that flips says the default changed: only when the PR changes a default (checked below).
			}
		}
		const text = JSON.stringify(ch);
		if (/TODO/.test(text)) {
			problems.push(`${id}: still has TODOs`);
		}
		const claims = valueChanges(ch, kit);
		const diff = claims.length ? prDiff(pick.slug) : null;
		if (diff !== null && !changesADefault(diff)) {
			problems.push(`${id}: ${claims.join('; ')}, but #${pick.number} doesn't change a default: show the state as it is (a toggle "on" or "off", not "flip"; a drawn setting without "before")`);
		}
		if ((ch.headline ?? '').length > 52) {
			problems.push(`${id}: the headline is ${ch.headline.length} characters; keep it under 52 (one line)`);
		}
		for (const r of [...(ch.before?.rows ?? []), ...(ch.now?.rows ?? [])]) {
			if (String(r.text ?? '').length > 30 && r.tone !== 'orange') {
				problems.push(`${id}: the row "${r.text}" is long (${r.text.length} characters; about 30 fit, or use sub for a second line)`);
			}
		}
		const h = stripHeight(ch);
		if (h > VIEW_H) {
			problems.push(`${id}: the strip is ${h} px tall; it must fit ${VIEW_H} px (fewer rows, no eyebrow, or no setting card)`);
		}
		const v = ch.visual ?? {};
		if (v.demo) {
			const f = path.join(bdir, 'demos', v.demo, 'demo.json');
			if (!fs.existsSync(f)) {
				problems.push(`${id}: demo "${v.demo}" not recorded yet (prs demo ${v.demo})`);
			} else {
				const demo = readDemo(f);
				if (!entries.length) {
					problems.push(`${id}: a demo needs "focus": the mark that shows the change (its Now row points to it)`);
				}
				for (const e of entries.filter(x => typeof x.part === 'string' && x.part)) {
					const focus = demo.marks[e.part];
					if (!focus) {
						problems.push(`${id}: the focus "${e.part}" is not a mark of demo ${v.demo} (marks: ${Object.keys(demo.marks).join(', ') || 'none'})`);
					} else if (!focus.visible.length) {
						problems.push(`${id}: the focus "${e.part}" is never really on screen in demo ${v.demo} (covered, scrolled away, or never shown): look at its contact sheet and fix the demo, or use a scene or a card`);
					} else if (Math.max(...focus.visible.map(([a, b]) => b - a)) < 1) {
						problems.push(`${id}: the focus "${e.part}" is on screen under 1 s at a time in demo ${v.demo}: hold it longer (sleep) in the demo`);
					}
				}
				// The demo shows the PR's UI: text from the PR, in a focus mark, while it is on screen. A removal instead
				// names what the PR takes out, and the recording shows where it was, without it.
				const proofs = [].concat(ch.proof ?? []);
				const removed = [].concat(ch.removed ?? []);
				const shown = proofText(entries.flatMap(e => [...(demo.marks[e.part]?.texts ?? []), demo.marks[e.part]?.text ?? '']).join('\n'));
				const names = entries.map(e => `"${e.part}"`).join(', ');
				if (!proofs.length && !removed.length) {
					problems.push(`${id}: a demo needs "proof": text from #${pick.number} that its focus mark shows (a label, a setting's description, a command); for a removal, "removed": what the PR takes out, which the recording shows gone`);
				}
				for (const r of removed) {
					const problem = removalProblem(r, prDiff(pick.slug), demo);
					if (problem) {
						problems.push(`${id}: ${problem}`);
					}
				}
				for (const proof of proofs) {
					if (proofText(proof).length < 10) {
						problems.push(`${id}: the proof "${proof}" is too short to prove anything: 10 characters or more`);
					} else if (!isPr(proof)) {
						problems.push(`${id}: the proof "${proof}" is not in ${where}`);
					} else if (proofText((demo.typed ?? []).join('\n')).includes(proofText(proof))) {
						problems.push(`${id}: the demo types "${proof}" itself: that proves nothing. Prove it with text VS Code shows (a label, a description) that the demo didn't type`);
					} else if (!shown.includes(proofText(proof))) {
						problems.push(`${id}: the focus ${names} never shows "${proof}" on screen: point the focus at the UI that says it (prs demo inspect ${v.demo}: the text on screen), or this demo doesn't show the change: use a scene or a card`);
					}
				}
				// The strip says what the recording shows (the build recorded can word the change differently than the PR).
				const unshown = corpus ? unshownParts(ch, demo, corpus) : [];
				if (unshown.length) {
					problems.push(`${id}: the Now rows say ${unshown.map(x => `"${x}"`).join(', ')}, which the recording never shows (the build recorded may word it differently): write what the recording shows, or leave it out`);
				}
				// The recording keeps the narration's pace: a cue that came late shows what the narration says after it says it.
				for (const c of demo.sync?.cues ?? []) {
					if (c.at - c.want > 0.8) {
						problems.push(`${id}: in demo ${v.demo}, cue "${c.phrase}" came ${(c.at - c.want).toFixed(1)} s late (the steps before it took longer than the narration allows): start them at an earlier cue, or cue a later phrase`);
					}
				}
			}
		} else if (!v.scene) {
			problems.push(`${id}: visual must be { "demo": id } or { "scene": { name, params } }`);
		}
	}
	// Record first: a drawn chapter is one whose UI couldn't run here, not one nobody tried to record.
	const untried = ids.filter(id => {
		const v = digest.chapters?.[id]?.visual;
		return v?.scene && v.scene.name !== 'card' && !fs.existsSync(path.join(dir, 'demos', `${id}.mjs`));
	});
	if (untried.length) {
		notes.push(`drawn with no recording tried: ${untried.join(', ')} (record first when the UI can run here, with prs demo; otherwise notes.md says why it can't)`);
	}
	if (fs.existsSync(path.join(bdir, 'timeline.json'))) {
		try {
			const { data } = await planDigest(slug);
			for (const seg of data.segments.filter(x => x.kind === 'chapter')) {
				if (seg.focusProblem) {
					problems.push(seg.focusProblem);
				}
			}
			notes.push(`video: ${data.total.toFixed(1)} s (${data.segments.map(x => `${x.id} ${(x.end - x.start).toFixed(1)}`).join(', ')})`);
			if (data.total > 75) {
				problems.push(`the video runs ${data.total.toFixed(1)} s: aim for 55-65 s (shorter narration, faster clips: clip.after)`);
			}
		} catch (error) {
			problems.push(error.message);
		}
	} else {
		notes.push(`no narration audio yet: prs voice ${slug}`);
	}
	return { problems, notes };
}

// ---------------------------------------------------------------------------------------------------------------
// The page and the frames

const esbuild = createRequire(path.join(ROOT, 'package.json'))('esbuild');

async function buildPage(slug, data) {
	const pdir = path.join(buildDir(slug), 'digest', 'page');
	fs.mkdirSync(pdir, { recursive: true });
	const entry = path.join(pdir, 'entry.js');
	fs.writeFileSync(entry, [
		`import createPlayer from ${JSON.stringify(path.join(ROOT, 'digest', 'player.js'))};`,
		'const player = createPlayer(document.getElementById(\'app\'), window.DATA);',
		// Seeked, then two frames painted: a screenshot taken mid-paint can show a stale piece of the page.
		'window.seek = async t => { await player.seek(t); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); };',
		'window.chunks = () => player.chunks();',
		// Every font loads before the first frame: a part measured before its font is in is too narrow.
		'window.ready = async () => { await Promise.all([...document.fonts].map(f => f.load().catch(() => null))); await document.fonts.ready; return [...document.fonts].filter(f => f.status === \'loaded\').map(f => `${f.family} ${f.weight}`); };',
	].join('\n'));
	await esbuild.build({
		entryPoints: [entry], bundle: true, format: 'iife', platform: 'browser', outfile: path.join(pdir, 'bundle.js'),
		loader: { '.svg': 'text' }, logLevel: 'error', absWorkingDir: ROOT, target: 'chrome120',
	});
	const css = ['theme/studio.css', 'digest/style.css'].map(f => `<link rel="stylesheet" href="${pathToFileURL(path.join(ROOT, f)).href}">`).join('');
	const html = path.join(pdir, 'index.html');
	fs.writeFileSync(html, `<!doctype html><html lang="en"><head><meta charset="utf-8">${css}
<style>html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#fff}#app{position:relative;width:1920px;height:1080px;overflow:hidden;background:#fff;font-family:Aptos,'Segoe UI',Inter,sans-serif;color:var(--ink)}</style>
</head><body><div id="app"></div><script>window.DATA=${JSON.stringify(data).replace(/</g, '\\u003c')}</script><script src="bundle.js?v=${Date.now()}"></script></body></html>`);
	return html;
}

/** Screenshots of the page at the given times, in parallel browsers; returns the caption phrases. */
async function capture(html, shots, type, workers) {
	const n = Math.max(1, Math.min(workers, shots.length));
	const browsers = await Promise.all(Array.from({ length: n }, () => launch()));
	let chunks = [];
	try {
		await Promise.all(browsers.map(async (browser, w) => {
			const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
			const errors = [];
			page.on('pageerror', e => errors.push(e.stack || e.message));
			page.on('console', m => m.type() === 'error' && !/Aptos/.test(m.location()?.url ?? '') && errors.push(m.text()));
			await page.route('**/*', r => (/^(file|data|blob):/.test(r.request().url()) ? r.continue() : r.abort()));
			await page.goto(pathToFileURL(html).href);
			await page.evaluate(() => window.ready());
			if (w === 0) {
				chunks = await page.evaluate(() => window.chunks());
			}
			const from = Math.floor(shots.length * w / n), to = Math.floor(shots.length * (w + 1) / n);
			for (let i = from; i < to; i++) {
				await page.evaluate(t => window.seek(t), shots[i].t);
				await page.screenshot({ path: shots[i].file, type, ...(type === 'jpeg' ? { quality: 93 } : {}) });
			}
			if (errors.length) {
				throw new Error(`The page reported errors:\n${errors.join('\n')}`);
			}
		}));
	} finally {
		await Promise.all(browsers.map(b => b.close()));
	}
	return chunks;
}

function grid(ffmpeg, files, out, cols = 3) {
	const rows = Math.ceil(files.length / cols);
	const pads = cols * rows - files.length;
	const inputs = files.flatMap(f => ['-i', f]);
	const scaled = [...files.map((_, i) => `[${i}]scale=640:-1[s${i}]`), ...Array.from({ length: pads }, (_, k) => `color=white:s=640x360[p${k}]`)];
	const cells = [...files.map((_, i) => `[s${i}]`), ...Array.from({ length: pads }, (_, k) => `[p${k}]`)];
	const lines = Array.from({ length: rows }, (_, r) => `${cells.slice(r * cols, r * cols + cols).join('')}${cols > 1 ? `hstack=${cols}` : 'null'}[r${r}]`);
	execFileSync(ffmpeg, ['-v', 'error', '-y', ...inputs, '-filter_complex', `${scaled.join(';')};${lines.join(';')};${Array.from({ length: rows }, (_, r) => `[r${r}]`).join('')}${rows > 1 ? `vstack=${rows}` : 'null'}`, '-frames:v', '1', out]);
}

/** Key moments of each segment: for a contact sheet. */
function keyMoments(data) {
	const times = [];
	for (const s of data.segments) {
		if (s.kind !== 'chapter') {
			times.push(r3(s.end - 0.8));
			continue;
		}
		const sp = s.spec;
		times.push(r3(Math.max(s.start + 1.2, sp.now.at - 0.3)));
		times.push(r3(Math.min(s.end - 0.6, sp.now.at + 1.6)));
		times.push(r3(s.end - 0.5));
	}
	return times;
}

/**
 * What to look at in each chapter: as it opens, each arrow as it starts and while it holds (or the middle, with no
 * arrow), and as it ends; each with what should be on screen then.
 */
function reviewMoments(data) {
	return data.segments.filter(s => s.kind === 'chapter').map(seg => {
		const moments = [{ t: seg.start + 0.8, what: 'it opens' }];
		for (const [i, f] of (seg.focus ?? []).entries()) {
			moments.push({ t: f.from + 0.3, what: `arrow ${i + 1}: "${f.row}" → ${f.name}` });
			if (f.until - f.from > 1.4) {
				moments.push({ t: (f.from + f.until) / 2 + 0.2, what: `arrow ${i + 1}, holding` });
			}
		}
		if (!seg.focus?.length) {
			moments.push({ t: (seg.start + seg.end) / 2, what: 'its middle (no arrow)' });
		}
		moments.push({ t: seg.end - 0.15, what: 'it ends' });
		return { id: seg.id, moments: moments.map(m => ({ ...m, t: r3(Math.max(seg.start + 0.1, Math.min(seg.end - 0.05, m.t))) })) };
	});
}

export async function stillsDigest(slug, { at = null, workers = 3 } = {}) {
	const { data } = await planDigest(slug);
	const html = await buildPage(slug, data);
	const dir = path.join(buildDir(slug), 'digest', 'stills');
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	const times = (at ?? keyMoments(data)).filter(t => t >= 0 && t <= data.total);
	const shots = times.map((t, i) => ({ t, file: path.join(dir, `${String(i + 1).padStart(2, '0')}-${t.toFixed(2)}s.png`) }));
	await capture(html, shots, 'png', workers);
	grid(findFfmpeg(), shots.map(s => s.file), path.join(dir, 'contact.png'));
	return { dir, shots, total: data.total };
}

/**
 * prs digest review: one sheet per chapter (build/digest/review/<id>.png) of the moments to check, each frame as the
 * video shows it with what should be on screen then and the words spoken; the frames are there full size too.
 */
export async function reviewDigest(slug, { workers = 3 } = {}) {
	const { data } = await planDigest(slug);
	const html = await buildPage(slug, data);
	const dir = path.join(buildDir(slug), 'digest', 'review');
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	const chapters = reviewMoments(data).map(c => ({
		...c, sheet: path.join(dir, `${c.id}.png`),
		moments: c.moments.map((m, k) => ({ ...m, file: path.join(dir, `${c.id}-${k + 1}.jpg`) })),
	}));
	await capture(html, chapters.flatMap(c => c.moments), 'jpeg', workers);
	const said = (id, t) => data.words.filter(w => w.seg === id && w.a <= t + 0.3 && w.b >= t - 1.6).map(w => w.display).join(' ');
	const esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
	const browser = await launch();
	try {
		const page = await browser.newPage({ viewport: { width: 2 * 960 + 36, height: 600 }, deviceScaleFactor: 1 });
		for (const c of chapters) {
			const cells = c.moments.map(m => `<figure><img src="${pathToFileURL(m.file).href}"><figcaption><b>${m.t.toFixed(2)} s · ${esc(m.what)}</b>${said(c.id, m.t) ? ` · “${esc(said(c.id, m.t))}”` : ''}</figcaption></figure>`).join('');
			// A file, not setContent: a page of its own may show the frames (file: URLs).
			const sheetHtml = path.join(dir, `.${c.id}.html`);
			fs.writeFileSync(sheetHtml, `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#e9ecf1;font:500 17px -apple-system,Segoe UI,sans-serif}main{display:grid;grid-template-columns:repeat(2,960px);gap:12px;padding:12px}figure{margin:0}img{width:960px;height:540px;display:block}figcaption{padding:6px 2px 2px;color:#333}</style><main>${cells}</main>`);
			await page.goto(pathToFileURL(sheetHtml).href, { waitUntil: 'load' });
			const broken = await page.evaluate(() => [...document.images].filter(i => !i.naturalWidth).length);
			if (broken) {
				throw new Error(`${broken} frame(s) of ${c.id} did not load for its review sheet`);
			}
			await page.screenshot({ path: c.sheet, fullPage: true });
			fs.rmSync(sheetHtml, { force: true });
		}
	} finally {
		await browser.close();
	}
	return { dir, chapters, total: data.total };
}

/** What a reviewer checks on each sheet. */
export const REVIEW_CHECKLIST = [
	'The UI on the right is the one the PR changes: a recording of it, a drawing of it, or a card when nothing changes on screen (something removed from a menu, a picker or a view is a change: it shows where it was); never another UI.',
	'Each ring sits on exactly what its row names, while that is on screen: no ring on empty space, on another part, or on something not there yet.',
	'What is said at each moment is what is on screen then: every label, option or value the narration names shows, in the build\'s words (a recorded build can word it differently than the PR: then the narration says what it shows, or leaves it out).',
	'Next to a recording, the strip says what the recording shows (the build recorded can word it differently than the PR).',
	'What each arrow points at and the strip are whole, uncovered and readable (the zoom may crop the UI around a part, and an arrow\'s line may cross text on its way: that is how the video looks); the headline, the strip and the narration say the same thing.',
];

export async function renderDigest(slug, { workers = 3 } = {}) {
	const { data, audio, tempo } = await planDigest(slug);
	const bdir = buildDir(slug), out = path.join(bdir, 'digest');
	fs.mkdirSync(out, { recursive: true });
	writeJson(path.join(out, 'timeline.json'), data);
	const ffmpeg = findFfmpeg();
	const wav = path.join(out, 'audio.wav');
	const tempoFilter = tempo === 1 ? '' : `,atempo=${tempo}`;
	const parts = audio.map((p, i) => `[s${i}]atrim=start=${Math.max(0, p.from).toFixed(3)}:end=${p.to.toFixed(3)},asetpts=PTS-STARTPTS${tempoFilter},adelay=delays=${Math.max(0, Math.round(p.at * 1000))}:all=1[a${i}]`);
	execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', path.join(bdir, 'narration.wav'), '-filter_complex',
		`[0:a]asplit=${audio.length}${audio.map((_, i) => `[s${i}]`).join('')};${parts.join(';')};${audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audio.length}:normalize=0:dropout_transition=0,apad=whole_dur=${data.total}[out]`,
		'-map', '[out]', '-ar', '48000', '-ac', '1', wav]);
	const html = await buildPage(slug, data);
	const frames = path.join(out, 'frames');
	fs.rmSync(frames, { recursive: true, force: true });
	fs.mkdirSync(frames, { recursive: true });
	const count = Math.ceil(data.total * FPS);
	const t0 = performance.now();
	const chunks = await capture(html, Array.from({ length: count }, (_, i) => ({ t: i / FPS, file: path.join(frames, `${String(i + 1).padStart(5, '0')}.jpg`) })), 'jpeg', workers);
	console.log(`${count} frames in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
	const mp4 = path.join(out, `${slug}.mp4`);
	execFileSync(ffmpeg, ['-v', 'error', '-y', '-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'), '-i', wav, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
		'-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-shortest', mp4]);
	const stamp = s => {
		const ms = Math.round(s * 1000);
		return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
	};
	const srt = path.join(out, `${slug}.srt`);
	fs.writeFileSync(srt, chunks.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(Math.min(c.end, data.total))}\n${c.text}\n`).join('\n'));
	const sheet = keyMoments(data).map(t => path.join(frames, `${String(Math.min(count, Math.round(t * FPS) + 1)).padStart(5, '0')}.jpg`));
	grid(ffmpeg, sheet, path.join(out, 'contact.png'));
	fs.rmSync(frames, { recursive: true, force: true });
	// Deliver: the mp4, its captions, the contact sheet and what a job needs to post it (to Slack).
	const picks = readJson(path.join(videoDir(slug), 'picks.json'));
	const voice = fs.existsSync(path.join(bdir, 'voice.json')) ? readJson(path.join(bdir, 'voice.json')).provider : null;
	const dest = path.join(loadConfig().deliver, slug);
	fs.mkdirSync(dest, { recursive: true });
	for (const f of [mp4, srt]) {
		fs.copyFileSync(f, path.join(dest, path.basename(f)));
	}
	fs.copyFileSync(path.join(out, 'contact.png'), path.join(dest, 'contact.png'));
	writeJson(path.join(dest, `${slug}.json`), {
		kind: 'changelog-digest', date: picks.date, title: `${data.meta.title} — ${data.meta.dateShort}`, seconds: data.total,
		mp4: `${slug}.mp4`, srt: `${slug}.srt`, voice, build: data.meta.build,
		picks: data.segments.filter(s => s.kind === 'chapter').map(s => ({ rank: s.spec.rank, flag: s.spec.flag, number: s.spec.number, url: s.spec.url, author: s.spec.author, headline: s.spec.headline, demo: !!s.clip })),
		published: new Date().toISOString(),
	});
	return { mp4: path.join(dest, `${slug}.mp4`), total: data.total, contact: path.join(out, 'contact.png') };
}

/** The scene kit, for Node: names, docs, params, windows and proofs (bundled: their icons are SVG files). */
export async function loadSceneDocs() {
	return (await sceneKit()).SCENES;
}

let kitModule = null;
/** The scene kit's module for Node (once per process): SCENES, and ICON_NAMES (what an "icon" can be). */
async function sceneKit() {
	if (!kitModule) {
		const out = path.join(ROOT, 'videos', '.scenes.node.mjs');
		fs.mkdirSync(path.dirname(out), { recursive: true });
		await esbuild.build({
			entryPoints: [path.join(ROOT, 'digest', 'scenes', 'index.js')], bundle: true, platform: 'node', format: 'esm', outfile: out,
			loader: { '.svg': 'text', '.css': 'empty' }, logLevel: 'silent', absWorkingDir: ROOT,
		});
		kitModule = await import(`${pathToFileURL(out).href}?v=${Date.now()}`);
	}
	return kitModule;
}

/** Every icon name a chapter uses: rows, heads and scene params ("icon", "tabIcon", and list-actions' "others"). */
export function iconsOf(value) {
	if (Array.isArray(value)) {
		return value.flatMap(iconsOf);
	}
	if (!value || typeof value !== 'object') {
		return [];
	}
	return Object.entries(value).flatMap(([k, v]) => (k === 'icon' || k === 'tabIcon') && typeof v === 'string' ? [v]
		: k === 'others' && Array.isArray(v) ? v.filter(x => typeof x === 'string')
			: iconsOf(v));
}

// ---------------------------------------------------------------------------------------------------------------
// The command

export async function digestCommand(args) {
	const sub = args._[0];
	switch (sub) {
		case 'new': {
			const mode = args.build ?? 'auto';
			if (!['auto', 'main', 'insiders'].includes(mode)) {
				throw new Error(`--build is auto (Insiders when one has the picks, else VS Code built from main), insiders (never build from main) or main: ${mode}`);
			}
			if (args.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(args.date))) {
				throw new Error(`--date is YYYY-MM-DD: ${args.date}`);
			}
			const { slug, picks, build } = await newDigest({ run: args.run ?? null, date: args.date ?? null, file: args.file ?? null, build: mode });
			console.log(`videos/${slug}: ${picks.length} picks${build ? `, demos in ${build.name} ${build.version ?? ''}${build.quality === 'main' ? ' built from main' : ''}` : ''}`);
			for (const [i, p] of picks.entries()) {
				console.log(`  c${i + 1} #${p.number} ${p.title}${p.inBuild === false ? '  (not in the demo build)' : ''}`);
			}
			console.log(`  read videos/${slug}/brief.md; write storyboard.json and digest.json (the generate-changelog-video skill)`);
			return 0;
		}
		case 'check': {
			const slug = digestSlug(args._[1]);
			const { problems, notes } = await checkDigest(slug);
			for (const n of notes) {
				console.log(n);
			}
			for (const p of problems) {
				console.log(`✗ ${p}`);
			}
			console.log(problems.length ? `${problems.length} problem(s)` : 'ready: prs digest stills, then prs digest render');
			return problems.length ? 1 : 0;
		}
		case 'stills': {
			const slug = digestSlug(args._[1]);
			const at = typeof args.at === 'string' ? args.at.split(',').map(Number) : null;
			const { dir, shots, total } = await stillsDigest(slug, { at, workers: Number(args.workers ?? 3) });
			console.log(`video ${total.toFixed(1)} s; stills: ${shots.map(s => path.basename(s.file)).join(', ')}`);
			console.log(`contact sheet: ${path.relative(process.cwd(), path.join(dir, 'contact.png'))}`);
			return 0;
		}
		case 'review': {
			const slug = digestSlug(args._[1]);
			const { chapters, total } = await reviewDigest(slug, { workers: Number(args.workers ?? 3) });
			console.log(`video ${total.toFixed(1)} s. Open each sheet at full size (and a frame of it when something is small):`);
			for (const c of chapters) {
				console.log(`  ${path.relative(process.cwd(), c.sheet)}: ${c.moments.map(m => `${m.t.toFixed(2)} s ${m.what}`).join('; ')}`);
			}
			console.log('On each, check:');
			for (const line of REVIEW_CHECKLIST) {
				console.log(`  - ${line}`);
			}
			return 0;
		}
		case 'render': {
			const slug = digestSlug(args._[1]);
			const { problems } = await checkDigest(slug);
			if (problems.length && !args.force) {
				for (const p of problems) {
					console.log(`✗ ${p}`);
				}
				console.log('fix these first (or --force)');
				return 1;
			}
			const { mp4, total, contact } = await renderDigest(slug, { workers: Number(args.workers ?? 3) });
			console.log(`delivered: ${mp4} (${total.toFixed(1)} s); contact sheet: ${path.relative(process.cwd(), contact)}`);
			return 0;
		}
		case 'scenes': {
			const SCENES = await loadSceneDocs();
			for (const s of Object.values(SCENES)) {
				console.log(`${s.name}: ${s.doc}`);
				for (const [k, v] of Object.entries(s.params)) {
					console.log(`    ${k}: ${v}`);
				}
				console.log(`    targets: ${s.targets.join(', ')}`);
			}
			console.log(`icons: ${(await sceneKit()).ICON_NAMES.join(', ')}, github`);
			return 0;
		}
		default:
			console.log('prs digest new [--date YYYY-MM-DD | --run id | --file report.md] [--build auto|insiders|main] | check | stills [--at 1,2] | review | render | scenes');
			return sub ? 1 : 0;
	}
}
