// Runs a how-to-test scenario in VS Code Insiders and records it.
//
//   node run.mjs <work dir>                     record every step (run/recording.webm, run/timeline.json, run/manifest.json)
//   node run.mjs <work dir> --probe [--until <step id>]
//                                               no recording: run the hidden steps (or up to <step id>), then save
//                                               run/probe.png (+ a small run/probe.jpg to look at) and run/probe-aria.yml
//                                               (what is on screen) and stop
//   options: --build <path to the .app>         another build (default: the installed Insiders)
//
// <work dir>/scenario.mjs exports { signedIn, agents, settings, workspace, steps } (see the skill's guide.md). The app
// runs in a throwaway profile with its own HOME, the user's keychain linked in (so macOS never asks), and, with
// signedIn, a copy of the user's Insiders sign-in. The temp folder holding all of it is deleted when the run ends,
// whatever happens. playwright-core comes from the plugin's cache folder (scripts/setup.mjs installs it there).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { makeHelpers } from './howto.mjs';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const work = path.resolve(args[0] ?? '');
const flag = name => args.includes(name);
const option = name => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : undefined);
const probe = flag('--probe');
const until = option('--until');
const INSIDERS = '/Applications/Visual Studio Code - Insiders.app';
const appPath = option('--build') ?? INSIDERS;
const CACHE = process.env.TEST_VIDEOS_HOME ?? path.join(os.homedir(), '.cache/test-videos');

function playwright() {
	const candidates = [process.env.PLAYWRIGHT_CORE, path.join(CACHE, 'node_modules/playwright-core')].filter(Boolean);
	const found = candidates.find(c => fs.existsSync(path.join(c, 'package.json')));
	if (!found) {
		throw new Error('playwright-core not found: run the plugin\'s scripts/setup.mjs (or set PLAYWRIGHT_CORE)');
	}
	return require(found);
}

function executable(app) {
	const macos = path.join(app, 'Contents/MacOS');
	const name = fs.readdirSync(macos).find(f => !f.startsWith('.'));
	return path.join(macos, name);
}

/** The user data folder of the same build kind, for a copy of the sign-in. */
function signedInProfile(app) {
	const product = JSON.parse(fs.readFileSync(path.join(app, 'Contents/Resources/app/product.json'), 'utf8'));
	return path.join(os.homedir(), 'Library/Application Support', product.nameLong === 'Visual Studio Code' ? 'Code' : product.nameLong.replace(/^Visual Studio /, ''));
}

const DEFAULT_SETTINGS = {
	'window.zoomLevel': 1,
	'files.simpleDialog.enable': true,
	'security.workspace.trust.enabled': false,
	'workbench.startupEditor': 'none',
	'workbench.tips.enabled': false,
	'workbench.hover.delay': 60000,
	'update.mode': 'none',
	'telemetry.telemetryLevel': 'off',
};

/**
 * At most `max` VS Code instances run at once, across every agent using the kit (more crash and drop frames on
 * macOS). Waits for a free slot; a slot whose process is gone is taken over. Returns the release function.
 */
async function acquireSlot(max = Number(process.env.TEST_VIDEOS_SLOTS ?? 2)) {
	const dir = path.join(CACHE, 'slots');
	fs.mkdirSync(dir, { recursive: true });
	let told = false;
	for (;;) {
		for (let i = 0; i < max; i++) {
			const file = path.join(dir, `slot-${i}.pid`);
			try {
				fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
				return () => {
					try {
						if (fs.readFileSync(file, 'utf8') === String(process.pid)) {
							fs.rmSync(file, { force: true });
						}
					} catch { }
				};
			} catch {
				try {
					process.kill(Number(fs.readFileSync(file, 'utf8')), 0);
				} catch {
					fs.rmSync(file, { force: true });
				}
			}
		}
		if (!told) {
			console.log(`waiting for a free VS Code slot (${max} in use by other runs)…`);
			told = true;
		}
		await new Promise(r => setTimeout(r, 3000));
	}
}

async function main() {
	if (!fs.existsSync(path.join(work, 'scenario.mjs'))) {
		throw new Error(`No scenario.mjs in ${work}`);
	}
	const release = await acquireSlot();
	process.on('exit', release);
	const scenario = (await import(pathToFileURL(path.join(work, 'scenario.mjs')).href + `?t=${Date.now()}`)).default;
	const takesFile = path.join(work, 'voice/takes.json');
	const takes = fs.existsSync(takesFile) ? JSON.parse(fs.readFileSync(takesFile, 'utf8')) : {};
	const runDir = path.join(work, 'run');
	fs.mkdirSync(runDir, { recursive: true });

	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-video-run-'));
	const home = path.join(tmp, 'home');
	const data = path.join(tmp, 'user-data');
	const videos = path.join(tmp, 'videos');
	const paths = { tmp, home, data, workspace: undefined };
	let app;
	const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
	// app.close() can wait forever, for example on VS Code's "A session is in progress" prompt while a chat request
	// still runs: after 15 s, kill the app's process group.
	const closeApp = async () => {
		const current = app;
		app = undefined;
		if (!current) {
			return;
		}
		const pid = current.process()?.pid;
		const closed = await Promise.race([current.close().then(() => true, () => true), new Promise(resolve => setTimeout(() => resolve(false), 15000))]);
		if (!closed && pid) {
			console.log('The app did not close within 15 s (a chat request still running?): killing it.');
			try { process.kill(-pid, 'SIGKILL'); } catch { }
			try { process.kill(pid, 'SIGKILL'); } catch { }
		}
	};
	// Last, once the recording is saved: kill any process still using this run's temp folder (app helpers, agent
	// hosts, shells the app started).
	const sweep = () => {
		const marker = path.basename(tmp);
		for (const line of execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')) {
			const match = /^\s*(?<pid>\d+)\s+(?<command>.*)$/.exec(line);
			if (match && match.groups.command.includes(marker) && Number(match.groups.pid) !== process.pid) {
				try { process.kill(Number(match.groups.pid), 'SIGKILL'); } catch { }
			}
		}
	};
	for (const signal of ['SIGINT', 'SIGTERM']) {
		process.on(signal, async () => {
			try { await closeApp(); } catch { }
			try { sweep(); } catch { }
			cleanup();
			process.exit(130);
		});
	}
	try {
		// Its own HOME, with the user's keychain linked in.
		fs.mkdirSync(path.join(home, 'Library'), { recursive: true });
		fs.symlinkSync(path.join(os.homedir(), 'Library/Keychains'), path.join(home, 'Library/Keychains'));
		// The settings, for the default profile and the Agents window's built-in profile.
		const settings = { ...DEFAULT_SETTINGS, ...(scenario.settings ?? {}) };
		for (const dir of [path.join(data, 'User'), path.join(data, 'User/profiles/builtin/agents')]) {
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, null, '\t'));
		}
		fs.mkdirSync(path.join(data, 'User/globalStorage'), { recursive: true });
		const state = path.join(data, 'User/globalStorage/state.vscdb');
		if (scenario.signedIn) {
			execFileSync('sqlite3', [path.join(signedInProfile(appPath), 'User/globalStorage/state.vscdb'), `.backup ${state}`]);
		} else {
			execFileSync('sqlite3', [state, 'CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB); INSERT INTO ItemTable (key, value) VALUES (\'builtinChatExtensionEnablementMigration\', \'true\');']);
		}
		// A throwaway workspace: files, and a git repository unless `git: false`.
		if (scenario.workspace) {
			const ws = path.join(tmp, scenario.workspace.name ?? 'workspace');
			for (const [file, text] of Object.entries(scenario.workspace.files ?? {})) {
				fs.mkdirSync(path.dirname(path.join(ws, file)), { recursive: true });
				fs.writeFileSync(path.join(ws, file), text);
			}
			fs.mkdirSync(ws, { recursive: true });
			if (scenario.workspace.git !== false) {
				execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: ws });
				execFileSync('git', ['add', '-A'], { cwd: ws });
				execFileSync('git', ['-c', 'user.email=tester@example.com', '-c', 'user.name=Tester', 'commit', '-qm', 'Initial commit', '--allow-empty'], { cwd: ws });
			}
			paths.workspace = ws;
		}

		// A clean environment: nothing that attaches the app to the caller's VS Code or Copilot.
		const env = { ...process.env, HOME: home };
		for (const key of Object.keys(env)) {
			if (/^(VSCODE_|ELECTRON_RUN_AS_NODE|COPILOT_|GH_TOKEN|GITHUB_TOKEN)/.test(key)) {
				delete env[key];
			}
		}
		Object.assign(env, scenario.env ?? {});
		const launchArgs = [
			`--user-data-dir=${data}`, `--extensions-dir=${path.join(tmp, 'extensions')}`, '--skip-welcome', '--skip-release-notes',
			...(scenario.agents ? ['--agents'] : []),
			...(scenario.args ?? []),
			...(paths.workspace && scenario.openWorkspace !== false && !scenario.agents ? [paths.workspace] : []),
		];
		const size = { width: 1920, height: 1080 };
		app = await playwright()._electron.launch({
			executablePath: executable(appPath),
			args: launchArgs,
			env,
			recordVideo: probe ? undefined : { dir: videos, size },
			timeout: 90000,
		});
		const page = await app.firstWindow();
		const videoStartedAt = Date.now();
		await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0]?.setBounds({ x: 0, y: 0, ...s }), size);
		// Only the scenario moves the pointer: the windows ignore the real mouse (the user's cursor passing over them, a
		// window opening or closing under it), which would trigger hovers and make the drawn pointer jump. Playwright's
		// input still arrives.
		const ignoreRealMouse = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.setIgnoreMouseEvents(true)));
		await ignoreRealMouse();
		app.on('window', () => ignoreRealMouse().catch(() => { }));
		await page.waitForLoadState('domcontentloaded');
		await page.locator('.monaco-workbench').waitFor({ timeout: 60000 });
		const product = JSON.parse(fs.readFileSync(path.join(appPath, 'Contents/Resources/app/product.json'), 'utf8'));

		const timeline = { videoStartedAt, build: { app: appPath, version: product.version, commit: product.commit }, signedIn: !!scenario.signedIn, events: [] };
		const writeTimeline = () => fs.writeFileSync(path.join(runDir, probe ? 'probe-timeline.json' : 'timeline.json'), JSON.stringify(timeline, null, 1));
		const mark = (kind, extra = {}) => {
			timeline.events.push({ t: Date.now(), kind, ...extra });
			writeTimeline();
		};
		const h = makeHelpers(page);
		// The window as shown: page.screenshot() clips to the page's own size, which the zoom level shrinks.
		// Also writes <name>.jpg, at most 1280 px wide, to look at: every image an agent opens stays in the session's history.
		const capture = async file => {
			const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
			fs.writeFileSync(file, Buffer.from(png, 'base64'));
			try {
				execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '72', '-Z', '1280', file, '--out', file.replace(/\.png$/, '.jpg')], { stdio: 'ignore' });
			} catch (error) {
				console.log(`  (no small copy of ${path.basename(file)}: ${error?.message ?? error})`);
			}
		};
		const results = [];
		const steps = scenario.steps ?? [];
		const last = until ? steps.findIndex(s => s.id === until) : (probe ? steps.findLastIndex(s => s.hidden) : steps.length - 1);
		if (until && last < 0) {
			throw new Error(`No step "${until}"`);
		}
		let failed;
		let shownOnce = false;
		for (const step of steps.slice(0, last + 1)) {
			const t0 = Date.now();
			if (!step.hidden) {
				if (!shownOnce) {
					await h.overlay();
					mark('viewport', { size: await page.evaluate(() => [innerWidth, innerHeight]) });
					shownOnce = true;
				}
				mark('step', { id: step.id });
			}
			const take = takes[step.id];
			const ctx = {
				page, app, h, work, paths, scenario, step: step.id, t0, take,
				mark,
				/** Marks where the zoom looks: a locator or a box (page pixels). */
				async look(target, extra = {}) {
					const box = typeof target?.boundingBox === 'function' ? await h.box(target) : target;
					mark('look', { box, ...extra });
					return box;
				},
				/** Waits until `seconds` after the step started. */
				async at(seconds) {
					const wait = t0 + seconds * 1000 - Date.now();
					if (wait > 0) {
						await new Promise(r => setTimeout(r, wait));
					}
				},
				/** When `word` (its nth occurrence) starts in this step's narration, in seconds from the step's start. */
				cue(word, nth = 0) {
					if (!take) {
						throw new Error(`No narration for step ${step.id}: run voice.py first`);
					}
					const norm = s => s.toLowerCase().replace(/[^a-z0-9']/g, '');
					const hits = take.words.filter(w => norm(w.w) === norm(word));
					if (!hits[nth]) {
						throw new Error(`No "${word}" (#${nth}) in the narration of ${step.id}: ${take.words.map(w => w.w).join(' ')}`);
					}
					return hits[nth].a;
				},
				/** Waits until the step's narration has ended, plus `tail` seconds. */
				async hold(tail = 0.25) {
					await ctx.at((take?.seconds ?? 0) + tail);
				},
				/**
				 * Does `fn` (a wait, a slow operation) and cuts that stretch out of the video, which shows `label`
				 * ("15 s later") in a badge where the cut is. Call it after the step's sentence has ended (ctx.hold()).
				 */
				async cut(label, fn) {
					mark('cut-start', { label });
					try {
						return await fn();
					} finally {
						mark('cut-end');
					}
				},
				async shot(name) {
					fs.mkdirSync(path.join(runDir, 'shots'), { recursive: true });
					await capture(path.join(runDir, 'shots', `${name}.png`));
				},
			};
			try {
				const details = await step.run(ctx);
				results.push({ id: step.id, status: 'passed', details: details ?? '' });
				console.log(`  PASS ${step.id}${details ? `: ${details}` : ''}`);
			} catch (error) {
				failed = error;
				results.push({ id: step.id, status: 'failed', details: String(error?.message ?? error) });
				console.log(`  FAIL ${step.id}: ${error?.message ?? error}`);
				try { await ctx.shot(`failed-${step.id}`); } catch { }
				break;
			}
		}
		if (!failed && !probe) {
			mark('end');
			// The video holds a moment on the end (compose.py adds 0.6 s): record past it.
			await page.waitForTimeout(1200);
		}
		if (probe) {
			await capture(path.join(runDir, 'probe.png'));
			fs.writeFileSync(path.join(runDir, 'probe-aria.yml'), await page.locator('body').ariaSnapshot());
			console.log(`probe: ${path.join(runDir, 'probe.jpg')} (small, to look at; probe.png is full size), ${path.join(runDir, 'probe-aria.yml')}`);
		}
		const video = probe ? undefined : page.video();
		await closeApp();
		if (video) {
			await video.saveAs(path.join(runDir, 'recording.webm'));
		}
		fs.writeFileSync(path.join(runDir, probe ? 'probe-manifest.json' : 'manifest.json'), JSON.stringify({ outcome: failed ? 'failed' : 'passed', build: timeline.build, signedIn: timeline.signedIn, steps: results }, null, 1));
		console.log(`${failed ? 'Outcome: failed' : 'Outcome: passed'} (${product.version} ${product.commit.slice(0, 10)}${scenario.signedIn ? ', signed in' : ''})${video ? `; recording: ${path.join(runDir, 'recording.webm')}` : ''}`);
		process.exitCode = failed ? 1 : 0;
	} finally {
		try { await closeApp(); } catch { }
		try { sweep(); } catch { }
		cleanup();
	}
}

main().catch(error => {
	console.error(error?.stack ?? error);
	process.exitCode = 1;
});
