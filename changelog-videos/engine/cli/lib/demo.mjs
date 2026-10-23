// prs demo <slug> <id>: records a demo of VS Code for a changelog digest. Runs videos/<slug>/demos/<id>.mjs against a
// VS Code build in a throwaway profile, records the window, and logs where the UI the script marks is and when it is
// on screen, so the video's arrows land on it exactly.
//
// The demo script (an ES module):
//   export const files = { 'README.md': '# My project\n' };   // the workspace (optional)
//   export const settings = { 'editor.minimap.enabled': false };  // user settings (optional)
//   export async function setup(ctx) { ... }   // before recording starts (optional): may openAgentsWindow()
//   export default async function demo(ctx) { ... }   // recorded
// ctx: page, run, palette, picker, pickerItem, setting, openUrl, terminal, chat.send/reply, moveTo, click, type,
// press, sleep, scheme, workspace, openAgentsWindow (in setup: the recording is then of the Agents window), and in the
// recorded part mark, step, cue, begin and hold.
// mark(name, locator, { text, tight }) logs that element's box and the times it is shown (with { text }: only while
// that text shows in it; with tight too, the box is the text's own: a sentence of a dialog):
// marks are followed for the whole recording, so give each one a locator that matches only its UI (filter by its
// text); step(label) logs a moment worth a still.
// cue(phrase, { nth, offset }) waits until the chapter's narration says the phrase (record after prs voice): the
// recording keeps the narration's pace and plays as recorded. The narration starts where the recording starts, or at
// begin(); cue.end() waits until it ends, and the clip ends there (or where the script does). hold(s) keeps what the
// last step() showed on screen at least s seconds, however long the UI took to show it.
//
// The build: the project's when prs digest new built VS Code from main for it (picks.json), or PRS_VSCODE (the
// executable: code-insiders on Linux; or VS Code built from source by prs build), or on macOS
// /Applications/Visual Studio Code - Insiders.app. Signed in when it can be, with a copy of the signed-in profile of
// the same build (Insiders, or Code OSS for a source build): on macOS with the login keychain (a signed-out window
// there asks for the keychain and starts without the account); on Linux when that profile keeps its secrets with
// Electron's basic encryption ("password-store": "basic" in its argv.json), which a copy started with
// --password-store=basic reads. Signed out otherwise (CI: no profile).
// Writes videos/<slug>/build/demos/<id>/: frames/ (30 fps, 2560x1440), demo.json, clip.mp4, contact.png, screen.txt
// (the text on screen at the end).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright-core';
import { CACHE, buildDir, findFfmpeg, isOffline, readJson, videoDir, writeJson } from './common.mjs';
import { launch } from './browser.mjs';
import { trackBoxAt } from '../../digest/track.js';

const SIZE = { width: 1280, height: 720 };
const FPS = 30;
const MAC_INSIDERS = '/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Code - Insiders';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function vscodePath() {
	const p = process.env.PRS_VSCODE || (process.platform === 'darwin' ? MAC_INSIDERS : null);
	if (!p || !fs.existsSync(p)) {
		throw new Error(`No VS Code build: set PRS_VSCODE to its executable, or to VS Code built from source (prs build) (${p ? `${p} does not exist` : 'code-insiders on Linux'})`);
	}
	return p;
}

/** VS Code built from source (prs build): a checkout with its product.json and its own Electron. */
export function isSourceBuild(p) {
	return fs.existsSync(path.join(p, 'product.json')) && fs.existsSync(path.join(p, '.build', 'electron'));
}

/**
 * How to start a build: its executable, the arguments before VS Code's own, its environment, the signed-in state a
 * demo copies (the state of the same build's own profile: on macOS its keychain entry decrypts it, on Linux Electron's
 * basic encryption when the build's argv.json asks for it), and that argv.json. A source build runs as code-oss-dev.
 */
function launchSpec(p) {
	const support = name => path.join(userDataRoot(), name, 'User/globalStorage/state.vscdb');
	if (isSourceBuild(p)) {
		const product = readJson(path.join(p, 'product.json'));
		const exe = process.platform === 'darwin'
			? path.join(p, '.build', 'electron', `${product.nameLong}.app`, 'Contents', 'MacOS', product.nameShort)
			: path.join(p, '.build', 'electron', product.applicationName);
		return {
			exe, args: [p, '--disable-extension=vscode.vscode-api-tests'],
			env: { NODE_ENV: 'development', VSCODE_DEV: '1', VSCODE_CLI: '1' },
			profile: 'Code OSS', state: support('code-oss-dev'), argv: path.join(os.homedir(), '.vscode-oss-dev', 'argv.json'),
		};
	}
	const { quality } = buildInfo(p);
	const profile = quality === 'insider' ? 'Code - Insiders' : quality === 'exploration' ? 'Code - Exploration' : 'Code';
	const dataFolder = { insider: '.vscode-insiders', exploration: '.vscode-exploration' }[quality] ?? '.vscode';
	return { exe: p, args: [], env: {}, profile, state: support(profile), argv: path.join(os.homedir(), dataFolder, 'argv.json') };
}

/** Where VS Code keeps its profiles on this OS, as VS Code itself works it out (getDefaultUserDataPath). */
export function userDataRoot(platform = process.platform, env = process.env, home = os.homedir()) {
	return platform === 'darwin' ? path.join(home, 'Library/Application Support') : env.XDG_CONFIG_HOME || path.join(home, '.config');
}

/** Whether a VS Code argv.json (JSON with comments) keeps secrets with Electron's basic encryption. */
export function usesBasicPasswordStore(argvFile) {
	try {
		return /^\s*"password-store"\s*:\s*"basic"/m.test(fs.readFileSync(argvFile, 'utf8'));
	} catch {
		return false;
	}
}

/**
 * Whether a copy of a build's signed-in profile can be recorded with here: 'ok'; 'no-profile' when the build was never
 * started here; 'no-basic-store' on Linux when its profile keeps its secrets in the OS keyring, which no copy can read;
 * 'unsupported' elsewhere (Windows keeps the GitHub session outside the profile).
 */
export function signInSource(spec, platform = process.platform) {
	if (platform !== 'darwin' && platform !== 'linux') {
		return 'unsupported';
	}
	if (!fs.existsSync(spec.state)) {
		return 'no-profile';
	}
	return platform === 'linux' && !usesBasicPasswordStore(spec.argv) ? 'no-basic-store' : 'ok';
}

/** The build's version and commit, from its product.json and package.json. */
export function buildInfo(exe = vscodePath()) {
	if (isSourceBuild(exe)) {
		const product = readJson(path.join(exe, 'product.json'));
		const pkg = readJson(path.join(exe, 'package.json'));
		const done = path.join(exe, '.prs-build.json');
		const meta = fs.existsSync(done) ? readJson(done) : {};
		let commit = meta.commit ?? null;
		if (!commit) {
			try {
				commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: exe, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
			} catch {
				commit = null;
			}
		}
		return { name: 'VS Code', quality: 'main', version: pkg.version ?? null, commit, scheme: product.urlProtocol ?? null, committedAt: meta.committedAt ?? null };
	}
	const roots = process.platform === 'darwin'
		? [path.join(exe, '../../Resources/app')]
		: [path.join(path.dirname(exe), 'resources/app'), path.join(path.dirname(exe), '../resources/app')];
	for (const root of roots) {
		if (fs.existsSync(path.join(root, 'product.json'))) {
			const product = JSON.parse(fs.readFileSync(path.join(root, 'product.json'), 'utf8'));
			const pkg = fs.existsSync(path.join(root, 'package.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) : {};
			return { name: product.nameLong ?? product.nameShort, quality: product.quality, version: pkg.version ?? null, commit: product.commit ?? null, scheme: product.urlProtocol ?? null };
		}
	}
	return { name: 'VS Code', quality: null, version: null, commit: null, scheme: null };
}

/** An X server for Linux runs without a display (CI): Xvfb on a free display number. */
async function ensureDisplay(env = process.env) {
	if (process.platform !== 'linux' || env.DISPLAY) {
		return null;
	}
	for (let n = 90; n < 110; n++) {
		if (fs.existsSync(`/tmp/.X11-unix/X${n}`) || fs.existsSync(`/tmp/.X${n}-lock`)) {
			continue;
		}
		const xvfb = spawn('Xvfb', [`:${n}`, '-screen', '0', '2600x1500x24', '-nolisten', 'tcp'], { stdio: 'ignore', env });
		for (let i = 0; i < 50 && !fs.existsSync(`/tmp/.X11-unix/X${n}`); i++) {
			await sleep(100);
		}
		if (!fs.existsSync(`/tmp/.X11-unix/X${n}`)) {
			xvfb.kill();
			throw new Error('Xvfb did not start (is it installed?)');
		}
		return { display: `:${n}`, stop: () => xvfb.kill() };
	}
	throw new Error('No free X display');
}

/** Opens VS Code on a workspace in a throwaway profile; close() deletes it (also on Ctrl+C and errors). */
/** Linux: kills every process started with this profile (a failed launch can leave VS Code's helpers running). */
function killProfileProcesses(marker) {
	if (process.platform !== 'linux') {
		return;
	}
	for (const pid of fs.readdirSync('/proc').filter(n => /^\d+$/.test(n) && Number(n) !== process.pid)) {
		try {
			if (fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(marker)) {
				process.kill(Number(pid), 'SIGKILL');
			}
		} catch { }
	}
}

/**
 * The fonts VS Code renders with on Linux: it looks like VS Code on a Mac (Inter is close to SF, and Menlo is based
 * on DejaVu Sans Mono). `packages` installs them on Ubuntu.
 */
export const LINUX_FONTS = { ui: 'Inter', mono: 'DejaVu Sans Mono', packages: 'fonts-inter fonts-dejavu-core fonts-dejavu-mono' };

/** fontconfig's default rules as Ubuntu enables them, minus colored sub-pixel edges (a recording is scaled). */
const FONT_RULES = {
	before: ['10-hinting-slight', '10-scale-bitmap-fonts', '10-sub-pixel-none', '10-yes-antialias', '20-unhint-small-vera', '30-metric-aliases', '40-nonlatin', '45-generic', '45-latin', '48-spacing', '49-sansserif'],
	after: ['60-generic', '60-latin', '65-fonts-persian', '65-nonlatin', '69-unifont', '70-no-bitmaps-except-emoji', '80-delicious', '90-synthetic'],
};

/**
 * The engine's font configuration for VS Code on Linux. It doesn't depend on /etc/fonts (a sandbox such as gh-aw's
 * doesn't mount it, and without its rules "sans-serif" and "monospace" map to no font: VS Code then renders in a
 * serif, and its terminal in a font that isn't monospaced). The system's default rules, then the engine's, before
 * 60-latin so they come first: the families VS Code asks for on Linux map to LINUX_FONTS.
 */
export function fontConfig({ cache, fonts = LINUX_FONTS, dirs = ['/usr/share/fonts', '/usr/local/share/fonts'], rules = '/usr/share/fontconfig/conf.avail' } = {}) {
	const include = names => names.map(n => `\t<include ignore_missing="yes">${rules}/${n}.conf</include>`);
	const prefer = (families, list) => families.map(f => `\t<alias binding="strong"><family>${f}</family><prefer>${list.map(x => `<family>${x}</family>`).join('')}</prefer></alias>`);
	return [
		'<?xml version="1.0"?>',
		'<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">',
		'<fontconfig>',
		...dirs.map(d => `\t<dir>${d}</dir>`),
		`\t<cachedir>${cache}</cachedir>`,
		...include(FONT_RULES.before),
		...prefer(['sans-serif', 'sans', 'system-ui', 'Ubuntu', 'Droid Sans'], [fonts.ui, 'DejaVu Sans', 'Liberation Sans']),
		...prefer(['monospace', 'mono', 'Droid Sans Mono', 'Ubuntu Mono'], [fonts.mono, 'Liberation Mono']),
		...prefer(['serif'], ['DejaVu Serif', 'Liberation Serif']),
		...include(FONT_RULES.after),
		'</fontconfig>',
		'',
	].join('\n');
}

/** On Linux, what is wrong with the fonts VS Code renders with: none when they are LINUX_FONTS. */
export function fontProblems(fonts, platform = process.platform) {
	if (platform !== 'linux') {
		return [];
	}
	const problems = [];
	if (!new RegExp(`^${LINUX_FONTS.ui}\\b`, 'i').test(fonts?.ui ?? '')) {
		problems.push(`its UI renders in ${fonts?.ui ?? 'no font'}, not ${LINUX_FONTS.ui}`);
	}
	if ((fonts?.mono ?? '').toLowerCase() !== LINUX_FONTS.mono.toLowerCase()) {
		problems.push(`its code renders in ${fonts?.mono ?? 'no font'}, not ${LINUX_FONTS.mono}`);
	}
	return problems;
}

/** The fonts VS Code renders its UI and its code with: DevTools' platform fonts of two sample texts in the window. */
export async function renderedFonts(page) {
	await page.evaluate(() => {
		const workbench = document.querySelector('.monaco-workbench') ?? document.body;
		// A file's editor (not the chat input's, in the UI font) when one is open, otherwise VS Code's default editor
		// fonts: the terminal uses the same.
		const editor = document.querySelector('.part.editor .monaco-editor .view-lines');
		const mono = editor ? getComputedStyle(editor).fontFamily : navigator.platform.startsWith('Mac') ? 'Menlo, Monaco, "Courier New", monospace' : navigator.platform.startsWith('Win') ? 'Consolas, "Courier New", monospace' : '"Droid Sans Mono", "monospace", monospace';
		for (const [id, family] of [['prs-font-ui', null], ['prs-font-mono', mono]]) {
			document.getElementById(id)?.remove();
			const el = document.createElement('span');
			el.id = id;
			el.textContent = 'Explorer Search Settings 0123456789';
			el.style.cssText = `position:fixed;left:-4000px;top:0;font-size:13px;white-space:nowrap;${family ? `font-family:${family};` : ''}`;
			workbench.appendChild(el);
		}
	});
	const cdp = await page.context().newCDPSession(page);
	try {
		await cdp.send('DOM.enable');
		await cdp.send('CSS.enable');
		const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
		const out = {};
		for (const [key, id] of [['ui', 'prs-font-ui'], ['mono', 'prs-font-mono']]) {
			const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `#${id}` });
			const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
			out[key] = [...fonts].sort((a, b) => b.glyphCount - a.glyphCount)[0]?.familyName ?? null;
		}
		return out;
	} finally {
		await cdp.detach().catch(() => { });
		await page.evaluate(() => {
			for (const id of ['prs-font-ui', 'prs-font-mono']) {
				document.getElementById(id)?.remove();
			}
		}).catch(() => { });
	}
}

/**
 * Linux: what VS Code needs that a sandbox (gh-aw's agent firewall) changes. Its own runtime directory (it puts its
 * sockets there, and shows a blocking dialog when the inherited one is not writable), the engine's font configuration
 * (fontConfig), and the system's libraries rather than the copies of headless Chrome's that the sandbox puts first
 * (VS Code starts outside the sandbox with the system's). LD_PRELOAD is left alone.
 */
export function prepareLinuxEnv(env, tmp) {
	const run = path.join(tmp, 'run');
	fs.mkdirSync(run, { mode: 0o700 });
	env.XDG_RUNTIME_DIR = run;
	if (env.LD_LIBRARY_PATH) {
		const kept = env.LD_LIBRARY_PATH.split(':').filter(p => p && !p.startsWith('/run/awf-lib/'));
		if (kept.length) {
			env.LD_LIBRARY_PATH = kept.join(':');
		} else {
			delete env.LD_LIBRARY_PATH;
		}
	}
	const conf = path.join(tmp, 'fonts.conf');
	fs.writeFileSync(conf, fontConfig({ cache: path.join(tmp, 'fontconfig') }));
	env.FONTCONFIG_FILE = conf;
	delete env.FONTCONFIG_PATH;
}

/** Linux: the whole X display as a PNG (a dialog VS Code is stuck on), when xwd and ffmpeg are there. */
function captureDisplay(display, out, env) {
	try {
		const xwd = `${out}.xwd`;
		execFileSync('xwd', ['-root', '-silent', '-display', display, '-out', xwd], { env, timeout: 10_000, stdio: 'ignore' });
		execFileSync(findFfmpeg(), ['-v', 'error', '-y', '-i', xwd, '-vf', 'scale=1300:-1', out], { timeout: 20_000, stdio: 'ignore' });
		fs.rmSync(xwd, { force: true });
		return out;
	} catch {
		return null;
	}
}

/** The end of VS Code's own main-process log in a profile, if it wrote one. */
function mainLogTail(userData, lines = 40) {
	try {
		const logs = path.join(userData, 'logs');
		const latest = fs.readdirSync(logs).sort().at(-1);
		const text = fs.readFileSync(path.join(logs, latest, 'main.log'), 'utf8');
		return text.split('\n').slice(-lines).join('\n');
	} catch {
		return '';
	}
}

/** How long VS Code may take to open its window. */
const LAUNCH_TIMEOUT = 60_000;

/**
 * When VS Code exits during launch, Playwright rejects the launch, and also leaves a second promise rejected with
 * nobody listening: Node would exit on it before the launch error is reported. Ignore that one; anything else still
 * ends the process as usual.
 */
let launchNoiseIgnored = false;
function ignoreLaunchNoise() {
	if (launchNoiseIgnored) {
		return;
	}
	launchNoiseIgnored = true;
	process.on('unhandledRejection', reason => {
		if (!/^(Process failed to launch!|Unable to open X display)/.test(String(reason?.message ?? reason))) {
			process.nextTick(() => {
				throw reason;
			});
		}
	});
}

/**
 * Whether VS Code's windows are invisible while it is driven and recorded (on a Mac, unless PRS_SHOW_WINDOW=1): the
 * recording is the page's own screencast and its pointer is drawn in the page, so nothing needs to be on screen, and
 * the user can't click into a window by accident. On Linux, recordings run on a virtual display already.
 */
export function hiddenWindows(platform = process.platform, env = process.env) {
	return platform === 'darwin' && env.PRS_SHOW_WINDOW !== '1';
}

/**
 * Makes a page behave as if its window had the focus, whatever the OS window does (as headless Chrome does): with
 * invisible windows, nothing on screen has the focus, and VS Code closes pickers when its window loses it. The CDP
 * session is kept for the page's lifetime: detaching it would end the emulation.
 */
async function emulateFocus(page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
	focusSessions.set(page, cdp);
}
const focusSessions = new WeakMap();

export async function openVSCode({ files = {}, settings = {}, signedIn = process.platform !== 'win32', log = console.log, failureShot = null, signIn = 'signed-out' } = {}) {
	const spec = launchSpec(vscodePath());
	const exe = spec.exe;
	removeStaleProfiles();
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prs-demo-'));
	let app, xserver;
	const cleanup = () => {
		try {
			app?.process()?.kill();
		} catch { }
		killProfileProcesses(tmp);
		xserver?.stop();
		fs.rmSync(tmp, { recursive: true, force: true });
	};
	const onSignal = () => {
		cleanup();
		process.exit(130);
	};
	process.once('SIGINT', onSignal);
	process.once('SIGTERM', onSignal);
	try {
		const home = path.join(tmp, 'home');
		const data = path.join(tmp, 'user-data');
		const workspace = path.join(tmp, 'my-project');
		fs.mkdirSync(path.join(data, 'User/globalStorage'), { recursive: true });
		fs.mkdirSync(home, { recursive: true });
		const env = { ...process.env, ...spec.env, HOME: home };
		if (process.platform === 'darwin') {
			// Its own HOME, with the login keychain linked in: without it macOS asks for a keychain.
			fs.mkdirSync(path.join(home, 'Library'), { recursive: true });
			fs.symlinkSync(path.join(os.homedir(), 'Library/Keychains'), path.join(home, 'Library/Keychains'));
		}
		if (signedIn) {
			const source = signInSource(spec);
			if (source !== 'ok') {
				// Nothing to sign in with: the build was never started here, or (Linux) its sign-in is in the OS keyring.
				// On Linux a missing profile is the usual case (CI), so it says nothing.
				signedIn = false;
				signIn = source === 'unsupported' || (source === 'no-profile' && process.platform !== 'darwin') ? 'signed-out' : source;
				if (signIn !== 'signed-out') {
					log(`${signInAdvice(signIn, spec)}: recording signed out`);
				}
			}
		}
		if (signedIn) {
			// Signed in: a copy of the signed-in state of the same build's own profile (on macOS its keychain entry
			// decrypts it; on Linux it's in Electron's basic encryption, and this copy starts with --password-store=basic).
			const state = spec.state;
			const copy = path.join(data, 'User/globalStorage/state.vscdb');
			execFileSync('sqlite3', [state, `.backup "${copy}"`]);
			// A clean demo: none of the recent folders or recently used commands.
			execFileSync('sqlite3', [copy, 'DELETE FROM ItemTable WHERE key IN (\'history.recentlyOpenedPathsList\', \'commandPalette.mru.cache\', \'commandPalette.mru.counter\')']);
		}
		writeJson(path.join(data, 'User/settings.json'), {
			'window.dialogStyle': 'custom',
			'window.restoreWindows': 'none',
			'update.mode': 'none',
			'telemetry.telemetryLevel': 'off',
			'workbench.tips.enabled': false,
			'extensions.autoCheckUpdates': false,
			'extensions.autoUpdate': false,
			// The terminal's text in the page (not a GPU canvas): a mark on it records what it says.
			'terminal.integrated.gpuAcceleration': 'off',
			// A terminal whose prompt shows no user or machine name (the default macOS prompt shows both): the shell
			// starts without the user's or the system's startup files.
			'terminal.integrated.profiles.osx': { demo: { path: '/bin/zsh', args: ['-f'], env: { PS1: '%1~ %# ' } } },
			'terminal.integrated.defaultProfile.osx': 'demo',
			'terminal.integrated.profiles.linux': { demo: { path: '/bin/bash', args: ['--noprofile', '--norc'], env: { PS1: '\\W $ ' } } },
			'terminal.integrated.defaultProfile.linux': 'demo',
			// A brand-new profile shows a full-window onboarding overlay ("Welcome to VS Code", sign in): on a slow
			// machine it comes up seconds into a recording and covers it. This turns it off before the window opens.
			'workbench.welcomePage.experimentalOnboarding': false,
			...settings,
		});
		for (const [name, content] of Object.entries(files)) {
			fs.mkdirSync(path.dirname(path.join(workspace, name)), { recursive: true });
			fs.writeFileSync(path.join(workspace, name), content);
		}
		fs.mkdirSync(workspace, { recursive: true });
		const args = [
			...spec.args,
			`--user-data-dir=${data}`, `--extensions-dir=${path.join(tmp, 'extensions')}`,
			'--skip-release-notes', '--skip-welcome', '--disable-telemetry', '--disable-experiments', '--no-cached-data',
			'--disable-updates', '--disable-workspace-trust', '--new-window', workspace,
		];
		if (isOffline()) {
			// Offline (a sandbox whose only way out is its proxy): VS Code's requests fail here, without reaching it.
			args.unshift('--no-proxy-server');
			for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
				delete env[name];
			}
		}
		if (process.platform === 'linux') {
			prepareLinuxEnv(env, tmp);
			xserver = await ensureDisplay(env);
			if (xserver) {
				env.DISPLAY = xserver.display;
			}
			args.unshift('--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--password-store=basic', '--force-device-scale-factor=2');
		}
		ignoreLaunchNoise();
		try {
			app = await _electron.launch({ executablePath: exe, args, env, timeout: LAUNCH_TIMEOUT });
		} catch (error) {
			// Playwright's call log holds what VS Code printed: keep it whole, with VS Code's own log and the screen.
			const shot = failureShot && xserver ? captureDisplay(xserver.display, failureShot, env) : null;
			const main = mainLogTail(data);
			throw new LaunchError(error, exe, [main && `VS Code's main log (end):\n${main}`, shot && `The display: ${shot}`].filter(Boolean).join('\n\n'));
		}
		if (hiddenWindows()) {
			await app.evaluate(({ app: electronApp, BrowserWindow }) => {
				const hide = w => {
					w.setOpacity(0);
					w.setIgnoreMouseEvents(true);
					// Never focused, so it never loses the focus either: VS Code closes pickers on a blur.
					w.setFocusable(false);
					w.webContents.setBackgroundThrottling(false);
					// VS Code focuses its window (a link it handles, a dialog it closes), which would make it the active app.
					w.focus = () => { };
					w.show = () => w.showInactive();
				};
				electronApp.focus = () => { };
				// Nor can the page's own window.focus() make it the active app, so the user's typing stays in their own
				// app; it leaves the Dock too.
				electronApp.setActivationPolicy('prohibited');
				BrowserWindow.getAllWindows().forEach(hide);
				electronApp.on('browser-window-created', (_event, w) => hide(w));
				// If it became the active app before that, hiding it gives the focus back; once it is hidden, its windows
				// are shown again without activating it, as a hidden window doesn't paint.
				globalThis.prsYieldFocus = () => {
					electronApp.hide();
					const started = Date.now();
					const showAgain = () => {
						if (electronApp.isHidden() || Date.now() - started > 3000) {
							BrowserWindow.getAllWindows().forEach(w => w.showInactive());
						} else {
							setTimeout(showAgain, 50);
						}
					};
					setTimeout(showAgain, 50);
				};
				electronApp.on('did-become-active', () => globalThis.prsYieldFocus());
			});
		}
		const page = await app.firstWindow({ timeout: LAUNCH_TIMEOUT });
		await app.evaluate(({ BrowserWindow }, s) => {
			const w = BrowserWindow.getAllWindows()[0];
			w.setPosition(40, 40);
			w.setContentSize(s.width, s.height);
			// It became the active app before it could be told not to: give the focus back.
			if (s.hidden && BrowserWindow.getFocusedWindow()) {
				globalThis.prsYieldFocus();
			}
		}, { ...SIZE, hidden: hiddenWindows() });
		await page.waitForSelector('.monaco-workbench', { timeout: LAUNCH_TIMEOUT });
		if (hiddenWindows()) {
			await emulateFocus(page);
		}
		if (signedIn) {
			const state = await sessionState(page, spec);
			if (state !== 'signed-in') {
				// Expired (Copilot asks to sign in again, in a modal that would cover the recording) or never signed in:
				// start again signed out, and say how to sign in.
				log(`${signInAdvice(state, spec)}: recording signed out`);
				await app.close().catch(() => { });
				cleanup();
				process.off('SIGINT', onSignal);
				process.off('SIGTERM', onSignal);
				return openVSCode({ files, settings, signedIn: false, log, failureShot, signIn: state });
			}
			signIn = state;
		}
		log(`VS Code up (${signedIn ? `signed in: a copy of the ${spec.profile} profile` : 'signed out'}${hiddenWindows() ? '; its windows are invisible: PRS_SHOW_WINDOW=1 shows them' : ''})`);
		return {
			app, page, workspace, signedIn, signIn, spec,
			async close() {
				await app.close().catch(() => { });
				cleanup();
				process.off('SIGINT', onSignal);
				process.off('SIGTERM', onSignal);
			},
		};
	} catch (error) {
		cleanup();
		process.off('SIGINT', onSignal);
		process.off('SIGTERM', onSignal);
		throw error;
	}
}

/**
 * Whether a build can record chat and the Agents window here: 'signed-in'; 'expired' when Copilot asks to sign in
 * again or says the token is invalid; 'signed-out' when the title bar keeps its Sign In button (never signed in); or
 * 'no-profile' when the build was never started here.
 */
export function signInState({ profile = true, expired = false, signInButton = false } = {}) {
	return !profile ? 'no-profile' : expired ? 'expired' : signInButton ? 'signed-out' : 'signed-in';
}

/** What to tell the user when a build isn't signed in (null when it is): why, and how to sign in. */
export function signInAdvice(state, spec, platform = process.platform) {
	const app = spec.profile === 'Code - Insiders' ? 'VS Code Insiders' : spec.profile;
	const why = {
		'no-profile': `${app} was never started on this ${platform === 'darwin' ? 'Mac' : 'machine'}`,
		'no-basic-store': `${app} keeps its GitHub sign-in in the system keyring, which a copy of its profile can't read`,
		'signed-out': `${app} isn't signed in to GitHub`,
		expired: `${app}'s GitHub sign-in has expired`,
	}[state];
	if (!why) {
		return null;
	}
	const where = spec.args?.[0] ? `in that build (start it with ${path.join(spec.args[0], 'scripts', 'code.sh')})` : `in ${app} (the Accounts menu)`;
	if (state === 'no-basic-store') {
		return `${why}, so chat and the Agents window can't be recorded. Add "password-store": "basic" to ${spec.argv}, sign in to GitHub again ${where}, then run prs demo check again`;
	}
	return `${why}, so chat and the Agents window can't be recorded. Sign in to GitHub ${where}, then run prs demo check again`;
}

/** The Agents window can't be recorded signed out: why, and what to do. */
function agentsSignInError(vscode) {
	const advice = signInAdvice(vscode.signIn, vscode.spec);
	return new Error(`The Agents window needs a GitHub sign-in, and VS Code runs signed out here${advice ? ` (${advice})` : ''}: when someone is watching, ask them to sign in and record again; otherwise draw this chapter (a scene)`);
}

/**
 * Removes throwaway profiles that interrupted runs left in `dir` (they hold a copy of the user's sign-in): any older
 * than 6 hours, which no recording lasts.
 */
export function removeStaleProfiles(dir = os.tmpdir(), now = Date.now()) {
	for (const name of fs.readdirSync(dir)) {
		const profile = path.join(dir, name);
		try {
			if (name.startsWith('prs-demo-') && now - fs.statSync(profile).mtimeMs > 6 * 3600 * 1000) {
				fs.rmSync(profile, { recursive: true, force: true });
			}
		} catch {
			// Removed meanwhile, or not ours to remove.
		}
	}
}

/**
 * The sign-in state of a copied profile, from what its window shows over about 12 s (VS Code shows the Sign In button
 * until the account resolves, so only one that stays counts). Remembered per profile: a sign-in for a day, anything
 * else until the profile changes (someone signs in).
 */
async function sessionState(page, spec) {
	const cacheFile = path.join(CACHE, 'sessions.json');
	const cache = fs.existsSync(cacheFile) ? readJson(cacheFile) : {};
	const mtime = fs.statSync(spec.state).mtimeMs;
	const known = cache[spec.state];
	if (known?.state && (known.state === 'signed-in' ? Date.now() - known.at < 24 * 3600 * 1000 : known.mtime === mtime)) {
		return known.state;
	}
	const expiredSigns = [page.getByText('Sign in to use GitHub Copilot'), page.getByText(/GitHub token is invalid/)];
	const button = page.locator('.titlebar [role="button"][aria-label="Sign In"]');
	let state = 'signed-in';
	let shown = 0;
	for (let i = 0; i < 24 && state === 'signed-in'; i++) {
		for (const sign of expiredSigns) {
			if (await sign.first().isVisible().catch(() => false)) {
				state = signInState({ expired: true });
			}
		}
		shown = await button.first().isVisible().catch(() => false) ? shown + 1 : 0;
		if (shown >= 4) {
			state = signInState({ signInButton: true });
		}
		if (state === 'signed-in') {
			await sleep(500);
		}
	}
	cache[spec.state] = { state, mtime, at: Date.now() };
	fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
	fs.writeFileSync(cacheFile, JSON.stringify(cache, null, '\t'));
	return state;
}

/** VS Code started, but renders with the wrong fonts (Linux): a recording would look broken. */
export class FontError extends Error {
	constructor(problems, fonts) {
		super(`VS Code ${problems.join(', and ')}: a recording would look broken. Install the fonts (sudo apt-get install ${LINUX_FONTS.packages})`);
		this.fonts = fonts;
	}
}

/** VS Code did not start: the whole launch log is in `log`, its last lines in the message. */
export class LaunchError extends Error {
	constructor(error, exe, extra = '') {
		const log = `${String(error?.message ?? error)}${extra ? `\n\n${extra}` : ''}`;
		const tail = log.split('\n').map(l => l.trimEnd()).filter(Boolean).slice(-14).join('\n  ');
		super(`VS Code did not start (${exe}): ${log.split('\n')[0]}\n  ${tail}`);
		this.log = log;
	}
}

/** A new user's first run (signed out): skip the sign-in screen and the theme page. */
export async function skipOnboarding(page) {
	const overlay = page.locator('.onboarding-a-overlay.visible');
	if (!await overlay.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false)) {
		return false;
	}
	for (const name of ['Continue without Signing In', 'Get Started']) {
		const button = overlay.getByRole('button', { name });
		if (await button.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false)) {
			await sleep(400);
			await button.click();
		}
	}
	await overlay.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => { });
	await sleep(600);
	return true;
}

/** A visible arrow cursor that follows the mouse (the screencast has no OS cursor). */
async function showCursor(page) {
	await page.evaluate(() => {
		if (document.getElementById('prs-cursor')) {
			return;
		}
		const ns = 'http://www.w3.org/2000/svg';
		const cursor = document.createElement('div');
		cursor.id = 'prs-cursor';
		cursor.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-200px,-200px);';
		const svg = document.createElementNS(ns, 'svg');
		svg.setAttribute('width', '26');
		svg.setAttribute('height', '26');
		svg.setAttribute('viewBox', '0 0 24 24');
		const arrow = document.createElementNS(ns, 'path');
		arrow.setAttribute('d', 'M4 2.5l13.5 12.2-6.2.6 3.7 7.3-2.6 1.3-3.6-7.4-4.8 4.1z');
		arrow.setAttribute('fill', '#fff');
		arrow.setAttribute('stroke', '#111');
		arrow.setAttribute('stroke-width', '1.4');
		arrow.setAttribute('stroke-linejoin', 'round');
		svg.appendChild(arrow);
		cursor.appendChild(svg);
		document.body.appendChild(cursor);
		document.addEventListener('mousemove', e => {
			cursor.style.transform = `translate(${e.clientX - 4}px,${e.clientY - 2}px)`;
		}, true);
	});
}

/** The helpers a demo script gets, for one window. */
function helpers(page, app) {
	const moveTo = async (locator, steps = 28) => {
		const box = await locator.boundingBox({ timeout: 10_000 });
		if (!box) {
			throw new Error(`Nothing to move to: ${locator}`);
		}
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
	};
	const click = async (locator, { pause = 300 } = {}) => {
		await moveTo(locator);
		await sleep(pause);
		const box = await locator.boundingBox();
		await page.mouse.down();
		await page.mouse.up();
		return box;
	};
	const palette = async (text, { delay = 18 } = {}) => {
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
		const widget = page.locator('.quick-input-widget');
		await widget.waitFor({ state: 'visible', timeout: 10_000 });
		await sleep(250);
		await page.keyboard.type(text, { delay });
		await sleep(450);
		return widget;
	};
	const run = async (command, options) => {
		await palette(command, options);
		await page.keyboard.press('Enter');
	};
	/** The chat input of this window: the Chat view's, a session's in the Agents window, or its new-session input. */
	const chatInput = () => page.locator('.interactive-input-part .monaco-editor, .chat-input-container .monaco-editor, .new-chat-input-area .monaco-editor').filter({ visible: true }).last();
	return {
		page, app, sleep,
		moveTo,
		/** Moves the mouse to it, then clicks (a real click, as a user would). */
		click,
		/** Runs a command from the Command Palette, typed as a user would. */
		run,
		/** Opens the Command Palette and types, without Enter: returns the picker (the commands it lists). */
		palette,
		/** The picker open in this window (the Command Palette, or the quick pick a command opened), and a row of it. */
		picker: () => page.locator('.quick-input-widget').filter({ visible: true }),
		pickerItem: label => page.locator('.quick-input-widget .monaco-list-row').filter({ visible: true }).filter({ hasText: label }).first(),
		/**
		 * Opens the Settings editor on one setting (searched by its ID) and returns its row, found by its ID (data-key):
		 * never by its wording, which the build may say differently than the PR. With the Settings editor already open
		 * (from setup(), or a step before), it searches in it: the Command Palette doesn't open over it.
		 */
		async setting(id) {
			const editor = page.locator('.settings-editor').filter({ visible: true }).first();
			if (await editor.count()) {
				await click(editor.locator('.settings-header .search-container .suggest-input-container').first());
				await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
			} else {
				await run('Preferences: Open Settings (UI)');
				await editor.waitFor({ state: 'visible', timeout: 15_000 });
				await sleep(600);
			}
			await page.keyboard.type(id, { delay: 25 });
			const row = editor.locator(`.setting-item-contents[data-key="${id}"]`).first();
			await row.waitFor({ state: 'visible', timeout: 15_000 });
			return row;
		},
		/** Opens a vscode:// (or vscode-insiders://) link inside this window (Developer: Open URL), pasted. */
		async openUrl(url) {
			await run('Developer: Open URL');
			await page.locator('.quick-input-widget input').first().waitFor({ state: 'visible', timeout: 10_000 });
			await page.keyboard.insertText(url);
			await sleep(350);
			await page.keyboard.press('Enter');
		},
		/** Opens a new terminal and runs a command in it (typed); returns the terminal's text area (for a mark). */
		async terminal(command, { delay = 35 } = {}) {
			await run('Terminal: Create New Terminal');
			const rows = page.locator('.terminal-wrapper.active .xterm-rows, .terminal-wrapper .xterm-rows').filter({ visible: true }).last();
			await rows.waitFor({ state: 'visible', timeout: 20_000 });
			await sleep(1500);
			if (command) {
				await page.keyboard.type(command, { delay });
				await page.keyboard.press('Enter');
			}
			return rows;
		},
		/** Copilot chat in this window: send a prompt, wait for the reply. */
		chat: {
			input: chatInput,
			async send(text, { delay = 15 } = {}) {
				const input = chatInput();
				await input.waitFor({ state: 'visible', timeout: 20_000 });
				await click(input);
				await sleep(300);
				await page.keyboard.type(text, { delay });
				await sleep(300);
				await page.keyboard.press('Enter');
			},
			/** Waits until the reply is done: a Send button again, and no Cancel or Stop. */
			async reply({ timeout = 180_000 } = {}) {
				const start = Date.now();
				await sleep(2500);
				while (Date.now() - start < timeout) {
					const busy = await page.locator('a.action-label[aria-label^="Cancel"], a.action-label[aria-label^="Stop"]').filter({ visible: true }).count();
					const send = await page.locator('a.action-label[aria-label^="Send"]').filter({ visible: true }).count();
					if (!busy && send) {
						return;
					}
					await sleep(1000);
				}
				throw new Error(`The chat's reply did not finish in ${timeout / 1000} s`);
			},
		},
		async type(text, { delay = 45 } = {}) {
			await page.keyboard.type(text, { delay });
		},
		async press(key) {
			await page.keyboard.press(key);
		},
		/** The product's own URL scheme: vscode-insiders for Insiders. */
		scheme: null,
	};
}

/**
 * The text on screen in a window, one line per shown element that holds text (or an icon button's label), top to
 * bottom: what a mark's { text } and a chapter's proof can be. Written to screen.txt after each demo.
 */
async function screenText(page) {
	return page.evaluate(() => {
		const lines = [], seen = new Set();
		for (const el of document.querySelectorAll('body *')) {
			if (el.closest('#prs-cursor')) {
				continue;
			}
			const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
			const label = !own && (el.matches('a.action-label, .codicon, button') || el.getAttribute('role') === 'button') ? el.getAttribute('aria-label') ?? '' : '';
			const text = own || label;
			if (!text || !el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true })) {
				continue;
			}
			const r = el.getBoundingClientRect();
			if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) {
				continue;
			}
			const key = `${text}|${Math.round(r.x)}|${Math.round(r.y)}`;
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			const cls = [...el.classList].slice(0, 3).join('.');
			lines.push({ y: r.y, x: r.x, line: `${label ? `[${text}]` : text}    <${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}> ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` });
		}
		return lines.sort((a, b) => a.y - b.y || a.x - b.x).map(l => l.line).slice(0, 600).join('\n');
	});
}

/** Every repaint of the window as a JPEG at device resolution, with its time; stop() returns the frames. */
async function screencast(page, dir) {
	const frames = [];
	const cdp = await page.context().newCDPSession(page);
	cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
		const file = path.join(dir, `${String(frames.length).padStart(5, '0')}.jpg`);
		fs.writeFileSync(file, Buffer.from(data, 'base64'));
		frames.push({ file, t: metadata.timestamp });
		cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => { });
	});
	await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: SIZE.width * 2, maxHeight: SIZE.height * 2, everyNthFrame: 1 });
	return {
		frames,
		async stop() {
			await cdp.send('Page.stopScreencast').catch(() => { });
			await sleep(200);
			return frames;
		},
	};
}

/** The box of the first shown element of a locator's matches (or of a text inside it), in the page; null if none. */
function measure(elements, { text, tight }) {
	// On top: at least 2 of 3 points across its middle hit it (or something inside it): not covered by an overlay, not
	// a row of a list that isn't the one on screen. Elements that let clicks through hit their parent: that counts. A
	// layer that draws nothing there (transparent, no border, no text of its own: the widget layer over a terminal)
	// doesn't cover it.
	const draws = n => {
		const st = getComputedStyle(n);
		const clear = c => c === 'transparent' || /^rgba\(.*,\s*0\)$/.test(c);
		return Number(st.opacity) > 0 && (!clear(st.backgroundColor) || st.backgroundImage !== 'none'
			|| ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(st[`border${side}Width`]) > 0 && !clear(st[`border${side}Color`]))
			|| [...n.childNodes].some(c => c.nodeType === 3 && c.data.trim()));
	};
	const onTop = (el, r) => {
		let hits = 0;
		for (const fx of [0.5, 0.2, 0.8]) {
			const x = r.x + r.width * fx, y = r.y + r.height / 2;
			if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) {
				continue;
			}
			const mine = n => n === el || el.contains(n) || n.contains(el);
			const hit = document.elementsFromPoint(x, y).find(n => mine(n) || draws(n));
			if (hit && mine(hit)) {
				hits++;
			}
		}
		return hits >= 2;
	};
	for (const el of elements) {
		if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) {
			continue;
		}
		const box = el.getBoundingClientRect();
		let r = box;
		if (text) {
			// The words themselves (a sentence of a paragraph): a range over the text nodes that hold them. The mark counts
			// only while they show (and aren't covered); its box stays the element's (the ring goes around the whole UI), or
			// with tight, is the words' own.
			const nodes = [];
			const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
			let all = '';
			while (walker.nextNode()) {
				nodes.push({ node: walker.currentNode, from: all.length });
				all += walker.currentNode.data;
			}
			// A terminal draws its spaces as no-break spaces: they count as spaces (one for one: the offsets hold). The last
			// time the text shows: a terminal's output comes after the command that printed it.
			const at = all.replace(/\u00a0/g, ' ').lastIndexOf(text.replace(/\u00a0/g, ' '));
			if (at < 0) {
				continue;
			}
			const find = i => {
				const n = nodes.findLast(x => x.from <= i);
				return [n.node, i - n.from];
			};
			const range = document.createRange();
			range.setStart(...find(at));
			range.setEnd(...find(at + text.length - 1));
			range.setEnd(range.endContainer, range.endOffset + 1);
			r = range.getBoundingClientRect();
		}
		const inWindow = r.width > 2 && r.height > 2 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
		if (inWindow && onTop(el, r)) {
			// What it says: a demo proves it shows the PR's UI with it.
			const said = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 4000);
			const b = text && tight ? r : box;
			return { x: b.x, y: b.y, width: b.width, height: b.height, text: said };
		}
	}
	return null;
}

/** Logs each marked element's box and visibility every 100 ms while recording. */
function markTracker(page) {
	const marks = new Map();
	let running = true;
	const sample = async () => {
		while (running) {
			for (const m of marks.values()) {
				// evaluateAll does not wait for a match: a mark that is not on screen costs nothing. Its time is when it was
				// measured (the middle of the call), so it matches the frame on screen then.
				const before = Date.now();
				const box = await m.locator.evaluateAll(measure, { text: m.text, tight: m.tight }).catch(() => null);
				m.samples.push({ t: (before + Date.now()) / 2000, box });
			}
			await sleep(100);
		}
	};
	const loop = sample();
	return {
		mark(name, locator, { text = null, tight = false } = {}) {
			if (!/^[a-zA-Z][\w.-]*$/.test(name)) {
				throw new Error(`mark(): "${name}" is not a valid name (letters, digits, ., - and _)`);
			}
			if (tight && !text) {
				throw new Error(`mark(): "${name}" is tight around its text: give { text }`);
			}
			marks.set(name, { locator, text, tight, samples: marks.get(name)?.samples ?? [] });
		},
		async stop() {
			running = false;
			await loop;
			return marks;
		},
	};
}

/**
 * Per mark: when it is really on screen (windows, clip seconds), where it is at each moment (track: [t, x, y, w, h]
 * of the samples it was on screen, about 10 a second), a representative box (rect: the middle of its longest window)
 * and what it said while on screen (text).
 */
export function summarizeMarks(marks, t0, duration, viewport = [SIZE.width, SIZE.height]) {
	const out = {};
	const r1 = v => +v.toFixed(1), r2 = v => +v.toFixed(2);
	// The frames are scaled to 1280x720 (2x): so are the boxes, if the page had another size.
	const kx = SIZE.width / viewport[0], ky = SIZE.height / viewport[1];
	const scale = b => b && { ...b, x: b.x * kx, y: b.y * ky, width: b.width * kx, height: b.height * ky };
	for (const [name, m] of marks) {
		const samples = m.samples.map(s => ({ t: r2(s.t - t0), box: scale(s.box) })).filter(s => s.t >= 0 && s.t <= duration + 0.05);
		const track = samples.filter(s => s.box).map(s => [s.t, r1(s.box.x), r1(s.box.y), r1(s.box.width), r1(s.box.height)]);
		const windows = [];
		let open = null;
		for (const s of samples) {
			if (s.box && !open) {
				open = { from: s.t, to: s.t, boxes: [] };
			}
			if (s.box) {
				open.to = s.t;
				open.boxes.push(s.box);
			} else if (open) {
				// It ends where it was last seen, not at the first sample that missed it: it may have closed just after.
				windows.push(open);
				open = null;
			}
		}
		if (open) {
			windows.push({ ...open, to: r2(duration) });
		}
		// One missed sample between two where it sits at the same place is a glitch, not a disappearance.
		const merged = [];
		for (const w of windows) {
			const prev = merged.at(-1);
			const a = prev?.boxes.at(-1), b = w.boxes[0];
			if (prev && w.from - prev.to <= 0.35 && Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 8) {
				prev.to = w.to;
				prev.boxes.push(...w.boxes);
			} else {
				merged.push({ ...w, boxes: [...w.boxes] });
			}
		}
		const kept = merged.filter(w => w.to - w.from >= 0.15);
		if (!kept.length) {
			out[name] = { rect: null, visible: [], texts: [], track: [], text: '' };
			continue;
		}
		const longest = kept.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a));
		const box = longest.boxes[Math.floor(longest.boxes.length / 2)];
		// Everything it said while on screen (a terminal fills up, a list filters): each different text once.
		const texts = [...new Set(kept.flatMap(w => w.boxes.map(b => b.text)).filter(Boolean))];
		out[name] = {
			rect: [box.x, box.y, box.width, box.height].map(r1),
			visible: kept.map(w => [Math.max(0, w.from), Math.min(duration, w.to)].map(r2)),
			// What it said in each of those windows: the arrow goes up only in one where it shows the proof.
			texts: kept.map(w => [...new Set(w.boxes.map(b => b.text).filter(Boolean))].join('\n').slice(0, 8000)),
			track,
			text: texts.join('\n').slice(0, 20000),
		};
	}
	return out;
}

/** A contact sheet of the recording: stills at its steps and every few seconds, with the marks drawn on them. */
async function demoContact(dir, info, out) {
	const times = [...new Set([...info.steps.map(s => s.t), ...Array.from({ length: 9 }, (_, i) => info.duration * (i + 0.5) / 9)].map(t => +Math.min(info.duration - 0.05, Math.max(0, t)).toFixed(2)))].sort((a, b) => a - b).slice(0, 15);
	const colors = ['#e81123', '#0078d4', '#107c10', '#d83b01', '#8661c5', '#00b7c3', '#ffb900'];
	const names = Object.keys(info.marks);
	const cells = times.map(t => {
		const frame = path.join(dir, 'frames', `${String(Math.min(info.count, Math.floor(t * FPS) + 1)).padStart(5, '0')}.jpg`);
		const step = info.steps.filter(s => Math.abs(s.t - t) < 0.01).map(s => s.label).join(', ');
		const boxes = names.map((n, i) => {
			const at = trackBoxAt(info.marks[n], t);
			if (!at) {
				return '';
			}
			const [x, y, w, h] = at.map(v => v / 2);
			return `<div class="b" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-color:${colors[i % colors.length]}"><span style="background:${colors[i % colors.length]}">${n}</span></div>`;
		}).join('');
		return `<figure><div class="f"><img src="${pathToFileURL(frame).href}">${boxes}</div><figcaption>${t.toFixed(2)} s${step ? ` · ${step.replace(/</g, '&lt;')}` : ''}</figcaption></figure>`;
	});
	const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#e9ecf1;font:600 14px -apple-system,Segoe UI,sans-serif}main{display:grid;grid-template-columns:repeat(3,640px);gap:12px;padding:12px}figure{margin:0}.f{position:relative;width:640px;height:360px}.f img{width:640px;height:360px;display:block}.b{position:absolute;border:2px solid;box-sizing:border-box}.b span{position:absolute;left:-2px;top:-18px;color:#fff;font-size:11px;padding:1px 4px;white-space:nowrap}figcaption{padding:4px 2px}</style><main>${cells.join('')}</main>`;
	const file = path.join(dir, '.contact.html');
	fs.writeFileSync(file, html);
	const browser = await launch();
	try {
		const page = await browser.newPage({ viewport: { width: 3 * 652 + 12, height: 400 }, deviceScaleFactor: 1 });
		await page.goto(pathToFileURL(file).href);
		await page.screenshot({ path: out, fullPage: true });
	} finally {
		await browser.close();
		fs.rmSync(file, { force: true });
	}
}

/**
 * prs demo check: starts VS Code once and says whether demos can be recorded here (about 20 s). Writes
 * videos/.demo-check.json (and .png: the window, or .log: why it did not start).
 */
export async function demoCheck() {
	const dir = videoDir('');
	fs.mkdirSync(dir, { recursive: true });
	const base = path.join(dir, '.demo-check');
	for (const ext of ['.json', '.png', '.log']) {
		fs.rmSync(base + ext, { force: true });
	}
	const t0 = Date.now();
	let build = null;
	try {
		build = buildInfo();
		const vscode = await openVSCode({ files: { 'README.md': '# Check\n' }, log: () => { }, failureShot: base + '.png' });
		const signIn = vscode.signIn;
		const advice = signInAdvice(signIn, vscode.spec);
		let fonts;
		try {
			if (process.platform !== 'darwin') {
				await skipOnboarding(vscode.page);
			}
			await vscode.page.screenshot({ path: base + '.png' });
			fonts = await renderedFonts(vscode.page);
		} finally {
			await vscode.close();
		}
		const seconds = +((Date.now() - t0) / 1000).toFixed(1);
		const problems = fontProblems(fonts);
		if (problems.length) {
			throw new FontError(problems, fonts);
		}
		writeJson(base + '.json', { ok: true, build, fonts, seconds, signIn, at: new Date().toISOString() });
		console.log(`demos work here: ${build.name ?? 'VS Code'} ${build.version ?? ''} started in ${seconds} s, its UI in ${fonts.ui}, its code in ${fonts.mono} (${base}.png)`);
		console.log(signIn === 'signed-in'
			? 'signed in to GitHub: chat and the Agents window can be recorded'
			: advice ? `NOT SIGNED IN: ${advice}` : 'signed out (recordings here are): chat and the Agents window are drawn');
		return true;
	} catch (error) {
		fs.writeFileSync(base + '.log', error.log ?? String(error.stack ?? error));
		writeJson(base + '.json', { ok: false, build, ...(error.fonts ? { fonts: error.fonts } : {}), error: error.message.split('\n')[0], at: new Date().toISOString() });
		console.log(`demos don't work here: ${error.message}\n(the whole log: ${base}.log) Draw every chapter as a scene.`);
		return false;
	}
}

export async function demo(slug, id, { signedIn = process.platform !== 'win32' } = {}) {
	const script = path.join(videoDir(slug), 'demos', `${id}.mjs`);
	if (!fs.existsSync(script)) {
		throw new Error(`No demo script: ${script}`);
	}
	const mod = await import(`${pathToFileURL(script).href}?v=${Date.now()}`);
	if (typeof mod.default !== 'function') {
		throw new Error(`${script} must export default async function demo(ctx)`);
	}
	const out = path.join(buildDir(slug), 'demos', id);
	const failures = path.join(buildDir(slug), 'demos', 'launch-failures.log');
	const failed = fs.existsSync(failures) ? fs.readFileSync(failures, 'utf8').split('\n=====\n').filter(Boolean).length : 0;
	if (failed >= 2) {
		throw new Error(`VS Code failed to start ${failed} times in this project (${failures}): demos don't work here, draw this chapter as a scene`);
	}
	fs.rmSync(out, { recursive: true, force: true });
	const raw = path.join(out, 'raw');
	fs.mkdirSync(raw, { recursive: true });
	const t0 = Date.now();
	const log = (...a) => console.log(`[demo ${id} ${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
	// The project's build when prs digest new downloaded or built one for it (its picks aren't in PRS_VSCODE's).
	const picksFile = path.join(videoDir(slug), 'picks.json');
	const own = fs.existsSync(picksFile) ? readJson(picksFile).build?.path : null;
	if (own) {
		if (!fs.existsSync(own)) {
			throw new Error(`This project's build is gone (${own}): run prs digest new again (it downloads or builds it), or set PRS_VSCODE`);
		}
		process.env.PRS_VSCODE = own;
		(await import('./build.mjs')).touchBuild(own);
	}
	const build = buildInfo();
	let vscode;
	try {
		vscode = await openVSCode({ files: mod.files ?? { 'README.md': '# My project\n' }, settings: mod.settings ?? {}, signedIn, log, failureShot: path.join(out, 'failure.png') });
	} catch (error) {
		fs.writeFileSync(path.join(out, 'failure.log'), error.log ?? String(error.stack ?? error));
		fs.appendFileSync(failures, `${new Date().toISOString()} demo ${id}\n${error.log ?? error.message}\n=====\n`);
		throw error;
	}
	const { page, app } = vscode;
	// Everything the demo types (in any window): a proof the demo typed itself (a search for the setting) proves nothing.
	const typed = [];
	const hookTyping = p => {
		for (const fn of ['type', 'insertText']) {
			const original = p.keyboard[fn].bind(p.keyboard);
			p.keyboard[fn] = (text, ...rest) => {
				typed.push(String(text));
				return original(text, ...rest);
			};
		}
	};
	hookTyping(page);
	const scheme = build.scheme ?? (build.quality === 'insider' ? 'vscode-insiders' : 'vscode');
	// The window the demo works in, and records: the main window, or the Agents window once setup() opens it.
	const win = { page, recording: false };
	const openAgentsWindow = async () => {
		if (win.recording) {
			throw new Error('Open the Agents window in setup(), before the recording starts: the recording is of one window');
		}
		if (!vscode.signedIn) {
			throw agentsSignInError(vscode);
		}
		const opened = app.waitForEvent('window', { timeout: 30_000 });
		const main = helpers(page, app);
		await main.palette('Open Agents Window');
		const found = await page.locator('.quick-input-widget .monaco-list-row').filter({ visible: true }).filter({ hasText: /Agents Window|Open in Agents/ }).count();
		if (!found) {
			await page.keyboard.press('Escape');
			throw new Error('This build has no "Open Agents Window" command');
		}
		await page.keyboard.press('Enter');
		const agents = await opened;
		await agents.waitForSelector('.monaco-workbench', { timeout: 60_000 });
		if (hiddenWindows()) {
			await emulateFocus(agents);
		}
		await app.evaluate(({ BrowserWindow }, s) => {
			const w = BrowserWindow.getAllWindows().reduce((a, b) => (a.id > b.id ? a : b));
			w.setPosition(40, 40);
			w.setContentSize(s.width, s.height);
		}, SIZE);
		await sleep(3000);
		// Signed out, the Agents window is a sign-in dialog over everything: nothing in it can be recorded.
		if (await agents.getByText('Sign in to use Agents', { exact: true }).isVisible().catch(() => false)) {
			throw agentsSignInError(vscode);
		}
		hookTyping(agents);
		win.page = agents;
		return { ...helpers(agents, app), scheme, workspace: vscode.workspace };
	};
	const ctxFor = () => ({ ...helpers(win.page, app), scheme, workspace: vscode.workspace, openAgentsWindow });
	let recording = null, tracker = null, fonts = null;
	const steps = [];
	try {
		if (!vscode.signedIn) {
			await skipOnboarding(page);
		}
		fonts = await renderedFonts(page);
		const problems = fontProblems(fonts);
		if (problems.length) {
			const error = new FontError(problems, fonts);
			fs.appendFileSync(failures, `${new Date().toISOString()} demo ${id}\n${error.message}\n=====\n`);
			throw error;
		}
		if (typeof mod.setup === 'function') {
			const notYet = () => {
				throw new Error('cue() and begin() pace the recording: use them in the demo, not in setup()');
			};
			await mod.setup({ ...ctxFor(), mark: () => { }, step: () => { }, begin: notYet, cue: Object.assign(notYet, { end: notYet }), hold: notYet });
		}
		// The narration of the chapter that shows this demo: cue(phrase) waits until the video says it.
		const { demoNarration, cueTime } = await import('./digest.mjs');
		const narration = demoNarration(slug, id);
		const rec = win.page;
		win.recording = true;
		await showCursor(rec);
		await rec.mouse.move(SIZE.width * 0.62, SIZE.height * 0.42);
		const viewport = await rec.evaluate(() => [innerWidth, innerHeight]);
		recording = await screencast(rec, raw);
		tracker = markTracker(rec);
		await sleep(400);
		const start = recording.frames[0]?.t ?? Date.now() / 1000;
		const now = () => Date.now() / 1000 - start;
		const sync = { at: null, end: null, cues: [] };
		const waitUntil = async (want, what) => {
			if (!narration) {
				throw new Error(`${what} waits for the narration of the chapter that shows demo ${id}: give that chapter "visual": { "demo": "${id}" } in digest.json, run prs voice, then record`);
			}
			sync.at ??= 0;
			const wait = sync.at + want - now();
			if (wait > 0) {
				await sleep(wait * 1000);
			}
			const late = now() - sync.at - want;
			if (late > 0.3) {
				log(`  ${what} came ${late.toFixed(1)} s late: the steps before it took longer than the narration allows`);
			}
			return sync.at + want;
		};
		const cue = async (phrase, { nth = 0, offset = 0 } = {}) => {
			const t = narration ? cueTime(narration.words, phrase, nth, ` (chapter ${narration.chapter})`) : 0;
			const want = await waitUntil(t + offset, `cue "${phrase}"`);
			sync.cues.push({ phrase: String(phrase), nth, t, want, at: now() });
		};
		// The clip ends here: what the script does after it (closing a dialog) isn't shown.
		cue.end = async ({ offset = 0 } = {}) => {
			await waitUntil((narration?.end ?? 0) + (narration?.tail ?? 0) + offset, 'cue.end()');
			sync.end = now();
			// What the script does next (closing a picker) comes after the clip's last frames, not in them.
			await sleep(300);
		};
		const begin = () => {
			if (sync.at !== null) {
				throw new Error('begin() comes once, before the first cue');
			}
			sync.at = now();
		};
		// hold(s): what the last step() showed stays on screen at least s seconds (however long the UI took to show it).
		let lastStep = null;
		const hold = async seconds => {
			const wait = lastStep === null ? 0 : lastStep + seconds - now();
			if (wait > 0) {
				await sleep(wait * 1000);
			}
		};
		await mod.default({
			...ctxFor(),
			mark: (name, locator, options) => tracker.mark(name, locator, options),
			step: label => {
				lastStep = now();
				steps.push({ label: String(label), t: +lastStep.toFixed(2) });
			},
			begin, cue, hold,
		});
		sync.end ??= now();
		await sleep(600);
		fs.writeFileSync(path.join(out, 'screen.txt'), await screenText(rec).catch(() => ''));
		const marks = await tracker.stop();
		tracker = null;
		const frames = await recording.stop();
		recording = null;
		// A window that never repaints sends one frame: it lasts the whole recording.
		if (!frames.length) {
			throw new Error('Nothing was recorded (the window never painted)');
		}
		const first = frames[0].t;
		const duration = Date.now() / 1000 - first;
		// A frame arrives only when the window repaints: each one lasts until the next. Resampled to 30 fps, 2560x1440.
		const list = frames.map((f, i) => `file '${f.file}'\nduration ${(i + 1 < frames.length ? frames[i + 1].t - f.t : Math.max(0.05, first + duration - f.t)).toFixed(4)}`).join('\n') + `\nfile '${frames.at(-1).file}'\n`;
		fs.writeFileSync(path.join(raw, 'frames.txt'), list);
		const ffmpeg = findFfmpeg();
		fs.mkdirSync(path.join(out, 'frames'), { recursive: true });
		execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(raw, 'frames.txt'), '-vf', `fps=${FPS},scale=2560:1440:flags=lanczos`, '-q:v', '3', path.join(out, 'frames', '%05d.jpg')]);
		const count = fs.readdirSync(path.join(out, 'frames')).filter(f => f.endsWith('.jpg')).length;
		execFileSync(ffmpeg, ['-v', 'error', '-y', '-framerate', String(FPS), '-i', path.join(out, 'frames', '%05d.jpg'), '-vf', 'scale=1280:720', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', path.join(out, 'clip.mp4')]);
		fs.rmSync(raw, { recursive: true, force: true });
		const shift = first - start, at2 = t => Math.max(0, +(t - shift).toFixed(2));
		const info = {
			id, fps: FPS, count, duration: +(count / FPS).toFixed(2), size: [SIZE.width, SIZE.height], scale: 2,
			build, signedIn: vscode.signedIn, fonts, recorded: new Date().toISOString(),
			steps: steps.map(s => ({ ...s, t: Math.max(0, +(s.t - (first - start)).toFixed(2)) })),
			...(sync.at === null ? {} : {
				sync: {
					chapter: narration.chapter, at: at2(sync.at), end: at2(sync.end),
					cues: sync.cues.map(c => ({ phrase: c.phrase, nth: c.nth, t: c.t, want: at2(c.want), at: at2(c.at) })),
				},
			}),
			viewport, typed: typed.filter(x => x.length > 1),
			marks: summarizeMarks(marks, first, count / FPS, viewport),
		};
		writeJson(path.join(out, 'demo.json'), info);
		await demoContact(out, info, path.join(out, 'contact.png'));
		log(`recorded ${info.duration} s (${count} frames) in ${build.name}${build.version ? ` ${build.version}` : ''}, its UI in ${fonts?.ui}, its code in ${fonts?.mono}`);
		for (const [name, m] of Object.entries(info.marks)) {
			log(`  mark ${name}: ${m.rect ? `[${m.rect.join(', ')}] visible ${m.visible.map(([a, b]) => `${a}-${b} s`).join(', ')}` : 'NEVER VISIBLE: check the locator'}`);
		}
		for (const s of info.steps) {
			log(`  step ${s.t} s: ${s.label}`);
		}
		if (info.sync) {
			log(`  in sync with ${info.sync.chapter}'s narration from ${info.sync.at} s to ${info.sync.end} s: ${info.sync.cues.map(c => `"${c.phrase}" at ${c.at} s${c.at - c.want > 0.3 ? ` (${(c.at - c.want).toFixed(1)} s late)` : ''}`).join(', ') || 'no cues'}`);
		}
		log(`look at ${path.relative(process.cwd(), path.join(out, 'contact.png'))} (and clip.mp4); the text on screen at the end: ${path.relative(process.cwd(), path.join(out, 'screen.txt'))}`);
		return info;
	} catch (error) {
		await win.page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => { });
		fs.writeFileSync(path.join(out, 'screen.txt'), await screenText(win.page).catch(() => ''));
		throw new Error(`${error.message.split('\n')[0]} (the window at that moment: ${path.join(out, 'failure.png')}; the text on it: ${path.join(out, 'screen.txt')})`);
	} finally {
		await tracker?.stop().catch(() => { });
		await recording?.stop().catch(() => { });
		await vscode.close();
	}
}
