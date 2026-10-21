#!/usr/bin/env node
// prs: make an explainer video for a pull request. Run `prs help` (or node cli/prs.mjs help).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAP, ROOT, guardOffline, resolveSlug, timed, videoDir } from './lib/common.mjs';

const HELP = `prs: pull request explainer videos

  prs new <PR URL | owner/repo#n>    fetch the PR and the files it changes into videos/<slug>/ (brief.md, storyboard skeleton)
  prs direct [slug] [--use beat=treatment --reason "..."] [--force] [--fresh]
                                     check the storyboard, then pick a diagram treatment for each beat and the motion (a
                                     re-run keeps the picks; --use re-picks one, with a reason; a beat with "footage": true
                                     gets ui.footage); scaffold scenes.js (--force rewrites it; --fresh picks all again)
  prs voice [slug] [--provider p] [--redo beat,...]  narration + word timing; --redo voices those beats again (a fresh take)
  prs preview [slug] [--at t1,t2]    key frames + contact sheet in build/stills/, then lint
  prs publish [slug]                 lint, render, encode, captions file, sync gate, deliver, add to the history
  prs review-pack [slug]             before each review round: the checks, cue timings, claims beside their lines and
                                     stills, in build/review/round-<n>/; from round 2, only what changed (and its neighbours)

  The steps on their own:
  prs check [slug]                   check the storyboard: the length cap, cues, placeholders, evidence anchors
  prs file <slug> <path> [--base]    print any file of the repository at the PR's head commit (--base: before the PR)
  prs app <slug> [--before]          the PR's VS Code Insiders build by commit (and the one before it), downloaded once: AFTER=<app>
  prs prepare [slug]                 verify every on-screen text and code reference; build the video page
  prs stills [slug] [--beat id] [--at t1,t2] [--ends]   key frames + contact sheet in build/stills/; --ends: one frame per beat, at its fullest
  prs lint [slug] [--every 0.5]      layout, text provenance, caption band, novelty, QR
  prs draft [slug]                   quick half-size preview mp4
  prs render [slug]                  final frames (cached; unchanged frames are reused)
  prs doctor [--deck] [--kokoro]     check this machine (commands install what they miss on first use); --kokoro: the offline voice
  prs catalog [--stills | --sheet f] list the treatments (and render their stills, or all on one numbered picture)
  prs catalog --icons                the icon names a treatment's icon fields take
  prs history [--last n]             what recent videos used (the next one is picked to look different)
  prs mark <slug> <step> [--deck]    note a step that isn't a command (review asked, verdict, capture done) in the run log
  prs smoke [--provider p]           make a short demo video end to end with timings (checks this machine)

Slides (the presentation skill):
  prs deck new --pr <PR> [slug]         start a deck about a PR: fetches it, fills the title card and the status (with its QR code)
  prs deck new <slug> [--title "..."]   start a deck on any topic in decks/<slug>/ (deck.mjs: the slides as plain data)
  prs deck build [slug] [--no-deliver]  PDF, one PNG per page, contact sheet, notes, checks; deliver to ~/Downloads/pr-decks/
  prs deck review <slug>                before each review round: the checks and every slide with its notes and sources, in
                                        decks/<slug>/review/round-<n>/; from round 2, only the slides that changed
  prs deck grid <slug> <assets/x.png> [--vs <assets/y.png>]
                                        the picture with a grid of its pixels, to read crop, pin and ring positions;
                                        --vs: where a before and an after of the same screen differ
  prs deck samples                      build the layout samples: one slide per layout, to pick from
  prs deck list                         the decks in decks/

PRS_OFFLINE=1: no network (an agent sandbox): run prs new before, then everything works from what it downloaded.
`;

/** Recordings in footage/ that no beat shows: a video made with pr-studio 0.3, whose footage was laid into the rendered
 * frames by a script. Publishing renders the frames again, so it would deliver the video without its footage. */
function unshownFootage(slug, project) {
	const dir = path.join(videoDir(slug), 'footage');
	const recordings = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /\.(mp4|webm|mov|mkv)$/i.test(f)) : [];
	if (recordings.length && !Object.keys(project.footage ?? {}).length) {
		throw new Error(`footage/ has recordings (${recordings.join(', ')}) but no beat shows them, so this video would be delivered without them. Give the beat that shows the app "footage": true in storyboard.json, run prs direct ${slug} --force, fill its ui.footage params (src, from, to, at), then publish. Or move the recordings out of footage/ if the video doesn't show them.`);
	}
}

/** Marks this engine copy as in use, so the setup of another version keeps it while sessions still run it. */
function markUsed() {
	try {
		const now = new Date();
		fs.utimesSync(path.join(ROOT, '.setup-ready'), now, now);
	} catch {
		// Not a copy made by the plugin's setup (the engine's own repository).
	}
}

function parseArgs(argv) {
	const args = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith('--')) {
			const [k, v] = a.slice(2).split('=');
			if (v !== undefined) {
				args[k] = v;
			} else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
				args[k] = argv[++i];
			} else {
				args[k] = true;
			}
		} else {
			args._.push(a);
		}
	}
	return args;
}

/** What this run is about, for its run log: a video's slug or a deck's. */
const RUN = { slug: null, deck: null };

/** The run log of a video (build/run-log.jsonl) or a deck (decks/<slug>/run-log.jsonl): every command and step, timed. */
function runLog({ slug, deck }) {
	if (deck) {
		const dir = path.join(ROOT, 'decks', deck);
		return fs.existsSync(dir) ? path.join(dir, 'run-log.jsonl') : null;
	}
	if (slug && fs.existsSync(videoDir(slug))) {
		fs.mkdirSync(path.join(videoDir(slug), 'build'), { recursive: true });
		return path.join(videoDir(slug), 'build', 'run-log.jsonl');
	}
	return null;
}

function appendRunLog(target, entry) {
	const file = runLog(target);
	if (file) {
		fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
	}
}

async function main() {
	guardOffline();
	markUsed();
	const [cmd, ...rest] = process.argv.slice(2);
	const args = parseArgs(rest);
	const started = new Date();
	let failed = false;
	try {
		await run(cmd, args);
	} catch (error) {
		failed = true;
		throw error;
	} finally {
		if (cmd && !['help', '--help', 'mark', 'doctor', 'catalog', 'history', 'smoke'].includes(cmd)) {
			appendRunLog(RUN, { at: started.toISOString(), cmd, args: rest.join(' ').slice(0, 200), seconds: +((Date.now() - started) / 1000).toFixed(1), exit: failed ? 1 : (process.exitCode ?? 0) });
		}
	}
}

async function run(cmd, args) {
	const slugArg = () => (RUN.slug = resolveSlug(args._[0]));
	// The repository's own commands (changelog, Slack requests, the gallery): the plugin's copy has no repo.mjs.
	if (fs.existsSync(fileURLToPath(new URL('./repo.mjs', import.meta.url)))) {
		const repo = await import('./repo.mjs');
		if (repo.REPO_COMMANDS.has(cmd)) {
			await repo.repoCommand(cmd, args);
			return;
		}
		if (cmd === 'history' && args.collect) {
			await repo.collectSessions();
		}
		if ([undefined, 'help', '--help'].includes(cmd)) {
			console.log(`${HELP}\nIn the repository:\n${repo.REPO_HELP}`);
			return;
		}
	}
	switch (cmd) {
		case undefined:
		case 'help':
		case '--help':
			console.log(HELP);
			return;
		case 'doctor': {
			const { doctor } = await import('./lib/doctor.mjs');
			process.exitCode = (await doctor(args)) ? 0 : 1;
			return;
		}
		case 'new': {
			const { newVideo } = await import('./lib/fetch.mjs');
			const { ref, data, code, reused } = await timed(null, 'new', () => newVideo(args._[0], args._[1], { force: !!args.force }));
			RUN.slug = ref.slug;
			console.log(`videos/${ref.slug}: ${data.facts.title}${reused ? ' (downloaded before this run: offline)' : ''}`);
			console.log(`  +${data.facts.additions} \u2212${data.facts.deletions} in ${data.facts.changedFiles} files \u00b7 head ${data.facts.headSha9} \u00b7 ${data.tier.name}: ${data.tier.beats} beats to start from, at most ${CAP.fileSeconds} s`);
			if (code) {
				console.log(`  code: ${code.saved} of the ${data.facts.files.length} changed files saved at the head commit${code.failed.length ? ` (not downloaded: ${code.failed.map(f => f.path).join(', ')})` : ''}`);
			}
			console.log(`  read videos/${ref.slug}/brief.md, then write videos/${ref.slug}/storyboard.json`);
			return;
		}
		case 'check': {
			const slug = slugArg();
			const { checkStory } = await import('./lib/check.mjs');
			const ok = await timed(slug, 'check', () => checkStory(slug));
			process.exitCode = ok ? 0 : 1;
			return;
		}
		case 'voice': {
			const slug = slugArg();
			await (await import('./lib/doctor.mjs')).ensureTools({ voice: true });
			const { voice } = await import('./lib/voice.mjs');
			await timed(slug, 'voice', () => voice(slug, { provider: args.provider, force: !!args.force, redo: typeof args.redo === 'string' ? args.redo : undefined, recording: args.recording }));
			return;
		}
		case 'direct': {
			const slug = slugArg();
			const { checkStory } = await import('./lib/check.mjs');
			if (!(await timed(slug, 'check', () => checkStory(slug)))) {
				process.exitCode = 1;
				return;
			}
			const { direct } = await import('./lib/direct.mjs');
			await timed(slug, 'direct', () => direct(slug, { seed: args.seed, motion: args.motion, use: args.use, reason: args.reason, force: !!args.force, fresh: !!args.fresh }));
			return;
		}
		case 'file': {
			// Any file of the repository at the PR's head commit (or --base, before the PR), for behaviour outside the diff.
			const slug = slugArg();
			const file = args._[1];
			if (!file) {
				throw new Error('Usage: prs file <slug> <path in the repository> [--base]');
			}
			const { readJson, videoDir } = await import('./lib/common.mjs');
			const { facts } = readJson(path.join(videoDir(slug), 'pr.json'));
			if (args.base) {
				const { fileAt } = await import('./lib/github.mjs');
				process.stdout.write(await fileAt(facts.repo, facts.baseSha, file));
			} else {
				const { fileAtHead } = await import('./lib/code.mjs');
				process.stdout.write(fileAtHead(slug, facts, file));
			}
			return;
		}
		case 'prepare': {
			const slug = slugArg();
			const { prepare } = await import('./lib/prepare.mjs');
			await timed(slug, 'prepare', () => prepare(slug));
			return;
		}
		case 'preview':
		case 'stills': {
			const slug = slugArg();
			await (await import('./lib/doctor.mjs')).ensureTools();
			const { prepare } = await import('./lib/prepare.mjs');
			const { stills } = await import('./lib/stills.mjs');
			await timed(slug, 'prepare', () => prepare(slug));
			const at = args.at ? String(args.at).split(',').map(Number) : null;
			const out = await timed(slug, 'stills', () => stills(slug, { at, beat: args.beat, ends: !!args.ends }));
			console.log(`${out.images.length} stills in ${out.dir}\ncontact sheet: ${out.sheet}`);
			if (cmd === 'preview') {
				const { lint } = await import('./lib/lint.mjs');
				process.exitCode = (await timed(slug, 'lint', () => lint(slug, { every: args.every ? Number(args.every) : 0 }))) ? 0 : 1;
			}
			return;
		}
		case 'lint': {
			const slug = slugArg();
			await (await import('./lib/doctor.mjs')).ensureTools();
			const { prepare } = await import('./lib/prepare.mjs');
			const { lint } = await import('./lib/lint.mjs');
			await timed(slug, 'prepare', () => prepare(slug, { quiet: true }));
			const ok = await timed(slug, 'lint', () => lint(slug, { every: args.every ? Number(args.every) : 0 }));
			process.exitCode = ok ? 0 : 1;
			return;
		}
		case 'draft':
		case 'render': {
			const slug = slugArg();
			await (await import('./lib/doctor.mjs')).ensureTools();
			const { prepare } = await import('./lib/prepare.mjs');
			const { render } = await import('./lib/render.mjs');
			await timed(slug, 'prepare', () => prepare(slug, { quiet: true }));
			await timed(slug, cmd, () => render(slug, { draft: cmd === 'draft', workers: args.workers ? Number(args.workers) : 0 }));
			return;
		}
		case 'publish': {
			// Lint (it must be clean), render (cached), then encode, the sync gate and the delivery.
			const slug = slugArg();
			await (await import('./lib/doctor.mjs')).ensureTools({ voice: true });
			const { prepare } = await import('./lib/prepare.mjs');
			const { lint } = await import('./lib/lint.mjs');
			const { render } = await import('./lib/render.mjs');
			const { publish } = await import('./lib/publish.mjs');
			const { project } = await timed(slug, 'prepare', () => prepare(slug, { quiet: true }));
			unshownFootage(slug, project);
			if (!args['skip-lint'] && !(await timed(slug, 'lint', () => lint(slug, { every: 0 })))) {
				throw new Error('lint found problems (above): fix them, then publish again');
			}
			await timed(slug, 'render', () => render(slug, { workers: args.workers ? Number(args.workers) : 0 }));
			await timed(slug, 'publish', () => publish(slug, { skipSync: !!args['skip-sync'] }));
			return;
		}
		case 'app': {
			const slug = slugArg();
			const { app } = await import('./lib/app.mjs');
			await timed(slug, 'app', () => app(slug, { before: !!args.before }));
			return;
		}
		case 'review-pack': {
			const slug = slugArg();
			await (await import('./lib/doctor.mjs')).ensureTools();
			const { reviewPack } = await import('./lib/review.mjs');
			await timed(slug, 'review-pack', () => reviewPack(slug));
			return;
		}
		case 'catalog': {
			if (args.stills || args.sheet) {
				await (await import('./lib/doctor.mjs')).ensureTools();
			}
			const { catalog } = await import('./lib/catalog.mjs');
			await catalog({ stills: !!args.stills, only: args.only, sheet: typeof args.sheet === 'string' ? args.sheet : null, icons: !!args.icons });
			return;
		}
		case 'history': {
			const { printHistory } = await import('./lib/history.mjs');
			printHistory(Number(args.last ?? 8));
			return;
		}
		case 'smoke': {
			const { smoke } = await import('./lib/smoke.mjs');
			const { ok } = await smoke({ provider: args.provider });
			process.exitCode = ok ? 0 : 1;
			return;
		}
		case 'deck': {
			const { deckCommand, deckOfCommand } = await import('./lib/deck.mjs');
			RUN.deck = deckOfCommand(args);
			process.exitCode = await deckCommand(args);
			return;
		}
		case 'mark': {
			// A step that isn't a prs command (a review asked or answered, a capture done), for the run log.
			const [slug, step] = args._;
			if (!slug || !step) {
				throw new Error('Usage: prs mark <slug> <step> [--deck] [--note "..."]');
			}
			const target = args.deck ? { deck: slug } : { slug: resolveSlug(slug) };
			if (!runLog(target)) {
				throw new Error(`No ${args.deck ? 'deck' : 'video'} "${slug}"`);
			}
			appendRunLog(target, { at: new Date().toISOString(), mark: step, ...(typeof args.note === 'string' ? { note: args.note.slice(0, 200) } : {}) });
			console.log(`${step}: noted in the run log`);
			return;
		}
		default:
			console.error(`Unknown command "${cmd}".\n${HELP}`);
			process.exitCode = 2;
	}
}

main().catch(error => {
	console.error(`prs: ${error.message}`);
	if (process.env.PRS_DEBUG) {
		console.error(error.stack);
	}
	process.exitCode = 1;
});
