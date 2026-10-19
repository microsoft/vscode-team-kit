// The capture kit: runs VS Code (an Insiders build from `prs app`, or any VS Code build) in a throwaway profile, and records
// or screenshots what a PR changes. It owns everything but the PR's own steps: a short temp folder, a HOME of its own
// with the keychain linked in, a copy of the sign-in when asked, the settings, the window's size, a drawn pointer, click
// rings and key badges, screenshots that work when zoomed, marks, and the cleanup. See shared/capture.md.
//
//   import { vscode } from '<studio>/capture/kit.mjs';
//   // node capture.mjs <app> after|before
//   await vscode({ repo: { files: { 'notes.md': '# Notes\n' } }, settings: { ... } }, async k => {
//     k.mark('open');
//     await k.click({ role: 'treeitem', name: 'notes.md' });
//     k.mark('preview');
//     await k.command('Markdown: Open Preview to the Side');
//     await k.see({ role: 'tab', name: '[Preview] notes.md' });
//     await k.shot('preview');
//   });
import { _electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const MAC = process.platform === 'darwin';

/** The settings every capture starts from: a light, quiet, zoomed-in window with nothing between the viewer and the change. */
const BASE_SETTINGS = {
	'window.zoomLevel': 1,
	'window.menuStyle': 'custom',
	'window.titleBarStyle': 'custom',
	'window.restoreWindows': 'none',
	'window.commandCenter': false,
	'update.mode': 'none',
	'telemetry.telemetryLevel': 'off',
	'workbench.startupEditor': 'none',
	'workbench.colorTheme': 'Default Light Modern',
	'workbench.tips.enabled': false,
	'workbench.welcomePage.walkthroughs.openOnInstall': false,
	'workbench.secondarySideBar.defaultVisibility': 'hidden',
	'workbench.layoutControl.enabled': false,
	'security.workspace.trust.enabled': false,
	'extensions.ignoreRecommendations': true,
	'git.autofetch': false,
	'git.openRepositoryInParentFolders': 'never',
	'editor.minimap.enabled': false,
};

/** The executable of an app: the path itself, or the one inside a macOS .app bundle. */
function executable(app) {
	if (!app) {
		throw new Error('vscode({ app }): the app to run: node capture.mjs <app> after (prs app <slug> prints the path of the PR\'s Insiders build)');
	}
	if (app.endsWith('.app') && fs.statSync(app).isDirectory()) {
		const dir = path.join(app, 'Contents', 'MacOS');
		const exe = fs.readdirSync(dir).find(f => !f.startsWith('.'));
		return path.join(dir, exe);
	}
	return app;
}

/** A short temp folder: VS Code puts a socket in its profile, and macOS caps a socket's path at about 100 characters. */
function shortTemp() {
	for (const base of ['/tmp', os.tmpdir(), os.homedir()]) {
		try {
			return fs.mkdtempSync(path.join(base, base === os.homedir() ? '.prs-' : 'prs-'));
		} catch {
			// Not writable here: the next one.
		}
	}
	throw new Error('no writable folder for the throwaway profile');
}

/** A sample git repository: `files` committed, then `change` applied (null deletes a file), staged when `stage`. */
function makeRepo(dir, home, { files = {}, change = {}, stage = false, message = 'Initial commit' }) {
	const git = (...args) => execFileSync('git', args, {
		cwd: dir, stdio: 'pipe',
		env: { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Sample', GIT_AUTHOR_EMAIL: 'sample@example.com', GIT_COMMITTER_NAME: 'Sample', GIT_COMMITTER_EMAIL: 'sample@example.com' },
	});
	const write = (file, text) => {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), text);
	};
	fs.mkdirSync(dir, { recursive: true });
	for (const [file, text] of Object.entries(files)) {
		write(file, text);
	}
	git('init', '-q', '-b', 'main');
	git('add', '-A');
	git('commit', '-q', '-m', message);
	for (const [file, text] of Object.entries(change)) {
		if (text === null) {
			fs.rmSync(path.join(dir, file), { force: true });
		} else {
			write(file, text);
		}
	}
	if (stage) {
		git('add', '-A');
	}
}

/** Draws a pointer that follows the mouse, a ring that grows on each click, and a badge for the keys pressed. */
async function installOverlay(page) {
	await page.evaluate(() => {
		if (document.getElementById('prs-pointer')) {
			return;
		}
		const ns = 'http://www.w3.org/2000/svg';
		const pointer = document.createElement('div');
		pointer.id = 'prs-pointer';
		Object.assign(pointer.style, { position: 'fixed', left: '0px', top: '0px', width: '22px', height: '30px', zIndex: '2147483647', pointerEvents: 'none', transform: 'translate(-100px, -100px)' });
		const svg = document.createElementNS(ns, 'svg');
		svg.setAttribute('width', '22');
		svg.setAttribute('height', '30');
		svg.setAttribute('viewBox', '0 0 22 30');
		const arrow = document.createElementNS(ns, 'path');
		arrow.setAttribute('d', 'M2 2 L2 24 L8 18.5 L12.5 28 L16.5 26.2 L12 17 L20 17 Z');
		arrow.setAttribute('fill', '#111');
		arrow.setAttribute('stroke', '#fff');
		arrow.setAttribute('stroke-width', '1.6');
		arrow.setAttribute('stroke-linejoin', 'round');
		svg.appendChild(arrow);
		pointer.appendChild(svg);
		document.body.appendChild(pointer);
		window.addEventListener('mousemove', e => {
			pointer.style.transform = `translate(${e.clientX - 2}px, ${e.clientY - 2}px)`;
		}, true);
		window.addEventListener('mousedown', e => {
			const ring = document.createElement('div');
			Object.assign(ring.style, { position: 'fixed', left: `${e.clientX - 6}px`, top: `${e.clientY - 6}px`, width: '12px', height: '12px', borderRadius: '50%', border: '3px solid #0078d4', background: 'rgba(0, 120, 212, 0.18)', zIndex: '2147483646', pointerEvents: 'none', transition: 'transform 600ms ease-out, opacity 600ms ease-out' });
			document.body.appendChild(ring);
			requestAnimationFrame(() => requestAnimationFrame(() => {
				ring.style.transform = 'scale(3.4)';
				ring.style.opacity = '0';
			}));
			setTimeout(() => ring.remove(), 800);
		}, true);
		const badge = document.createElement('div');
		badge.id = 'prs-keys';
		Object.assign(badge.style, { position: 'fixed', left: '50%', bottom: '48px', transform: 'translateX(-50%)', padding: '8px 16px', borderRadius: '10px', background: 'rgba(27, 27, 31, 0.86)', color: '#fff', font: '600 20px -apple-system, Segoe UI, sans-serif', letterSpacing: '0.06em', zIndex: '2147483647', pointerEvents: 'none', opacity: '0', transition: 'opacity 150ms' });
		document.body.appendChild(badge);
	});
}

const KEY_NAMES = MAC
	? { Meta: '\u2318', Control: '\u2303', Alt: '\u2325', Shift: '\u21e7', Enter: '\u21b5', Escape: 'Esc', Backspace: '\u232b', Tab: '\u21e5', ArrowUp: '\u2191', ArrowDown: '\u2193', ArrowLeft: '\u2190', ArrowRight: '\u2192' }
	: { Meta: 'Win', Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Enter: 'Enter', Escape: 'Esc', Backspace: 'Backspace', Tab: 'Tab', ArrowUp: '\u2191', ArrowDown: '\u2193', ArrowLeft: '\u2190', ArrowRight: '\u2192' };

/** The role and name of every element in an ARIA snapshot, and the ones closest to what was wanted. */
export function closest(snapshot, wanted, count = 6) {
	const items = [...String(snapshot).matchAll(/- (\w+) "([^"]*)"/g)].map(m => ({ role: m[1], name: m[2] }));
	const words = s => String(s).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3);
	const want = words(wanted);
	const score = it => {
		const have = words(it.name);
		const shared = want.filter(w => have.some(h => h.includes(w) || w.includes(h))).length;
		return shared * 10 - Math.abs(have.length - want.length);
	};
	const seen = new Set();
	return items.map(it => ({ ...it, score: score(it) })).filter(it => it.score > 0 && !seen.has(`${it.role}|${it.name}`) && seen.add(`${it.role}|${it.name}`))
		.sort((a, b) => b.score - a.score).slice(0, count).map(it => `${it.role} "${it.name}"`);
}

function describe(target) {
	if (typeof target === 'string') {
		return target;
	}
	if (target?.role) {
		return `${target.role}${target.name ? ` "${target.name}"` : ''}`;
	}
	if (target?.text) {
		return `text "${target.text}"`;
	}
	if (target?.label) {
		return `label "${target.label}"`;
	}
	return target?.css ?? 'the element';
}

/**
 * Runs VS Code in a throwaway profile, then `steps(kit)`, then closes it and removes the profile (and the copy of the
 * sign-in) whatever happens. Options:
 * - app: the app (a macOS .app or an executable), name: 'after' or 'before', out: the folder for what it makes. By
 *   default they come from the command line, `node capture.mjs <app> <name>`, and out is the script's folder.
 * - record: a video, `<name>.webm`, with `<name>.marks.json` (the seconds of each mark); false: screenshots only.
 * - repo: { files, change, stage } a sample git repository opened as the workspace, or workspace: a folder to open.
 * - settings: user settings over the kit's quiet, light, zoomed-in ones. signIn: copy the user's signed-in state (for
 *   chat and anything AI). size: [1280, 720].
 * - args: more arguments for the app (`--extensionDevelopmentPath=<folder>` loads a sample extension); env: more
 *   environment variables.
 */
export async function vscode(options, steps) {
	const [argApp, argName] = process.argv.slice(2);
	const script = process.argv[1] ? path.dirname(path.resolve(process.argv[1])) : process.cwd();
	const { app: appPath = argApp, out = script, name = argName ?? 'after', record = true, repo, workspace, settings = {}, signIn = false, size = [1280, 720], args = [], env = {} } = options;
	const exe = executable(appPath);
	fs.mkdirSync(out, { recursive: true });
	const tmp = shortTemp();
	const home = path.join(tmp, 'h'), data = path.join(tmp, 'd'), extensions = path.join(tmp, 'x'), videos = path.join(tmp, 'v');
	const folder = workspace ?? (repo ? path.join(tmp, 'w', 'sample') : null);
	const marks = [];
	let app = null, page = null, started = 0;
	try {
		if (MAC) {
			fs.mkdirSync(path.join(home, 'Library'), { recursive: true });
			fs.symlinkSync(path.join(os.homedir(), 'Library', 'Keychains'), path.join(home, 'Library', 'Keychains'));
		} else {
			fs.mkdirSync(home, { recursive: true });
		}
		fs.mkdirSync(path.join(data, 'User', 'globalStorage'), { recursive: true });
		fs.mkdirSync(extensions, { recursive: true });
		fs.writeFileSync(path.join(data, 'User', 'settings.json'), JSON.stringify({ ...BASE_SETTINGS, ...(signIn ? {} : { 'chat.disableAIFeatures': true }), ...settings }, null, '\t'));
		if (signIn) {
			const product = exe.includes('Insiders') ? 'Code - Insiders' : 'Code';
			const from = MAC ? path.join(os.homedir(), 'Library', 'Application Support', product, 'User', 'globalStorage', 'state.vscdb') : path.join(os.homedir(), '.config', product, 'User', 'globalStorage', 'state.vscdb');
			execFileSync('sqlite3', [from, `.backup ${path.join(data, 'User', 'globalStorage', 'state.vscdb')}`]);
		}
		if (repo) {
			makeRepo(folder, home, repo);
		}
		app = await _electron.launch({
			executablePath: exe,
			args: [...(folder ? [folder] : []), `--user-data-dir=${data}`, `--extensions-dir=${extensions}`, '--skip-release-notes', '--skip-welcome', '--disable-workspace-trust', '--force-device-scale-factor=2', ...args],
			env: { ...process.env, ...env, HOME: home },
			...(record ? { recordVideo: { dir: videos, size: { width: size[0], height: size[1] } } } : {}),
			timeout: 120_000,
		});
		page = await app.firstWindow();
		started = Date.now();
		await page.waitForSelector('.monaco-workbench .part.editor', { timeout: 60_000 });
		// Size the window once the workbench is up (the zoom applied), and keep anything from resizing it.
		await app.evaluate(({ BrowserWindow }, [w, h]) => {
			const win = BrowserWindow.getAllWindows()[0];
			win.setContentSize(w, h);
			win.center();
			win.setResizable(false);
		}, size);
		await page.waitForFunction(() => Math.abs(document.querySelector('.monaco-workbench').getBoundingClientRect().width - innerWidth) < 2, undefined, { timeout: 15_000 });
		await sleep(400);
		await installOverlay(page);
		const kit = makeKit({ app, page, out, name, marks, since: () => started });
		try {
			await steps(kit);
		} catch (error) {
			const where = error.probed ? null : await kit.probe('failed').catch(() => null);
			if (where) {
				error.message = `${error.message}\nWhat the window showed: ${where.file} (and ${where.png})`;
			}
			throw error;
		}
		if (record) {
			const video = page.video();
			await app.close();
			app = null;
			await video.saveAs(path.join(out, `${name}.webm`));
			fs.writeFileSync(path.join(out, `${name}.marks.json`), `${JSON.stringify({ name, size, marks }, null, '\t')}\n`);
			console.log(`recorded ${path.join(out, `${name}.webm`)} with ${marks.length} mark${marks.length === 1 ? '' : 's'}`);
		}
	} finally {
		await app?.close().catch(() => {});
		fs.rmSync(tmp, { recursive: true, force: true });
	}
}

function makeKit({ app, page, out, name, marks, since }) {
	const locate = target => {
		if (typeof target === 'string') {
			return page.locator(target).first();
		}
		if (target && typeof target.click === 'function' && typeof target.boundingBox === 'function') {
			return target;
		}
		if (target?.role) {
			return page.getByRole(target.role, { name: target.name, exact: target.exact ?? false }).first();
		}
		if (target?.text) {
			return page.getByText(target.text, { exact: target.exact ?? false }).first();
		}
		if (target?.label) {
			return page.getByLabel(target.label).first();
		}
		if (target?.css) {
			return page.locator(target.css).first();
		}
		throw new Error(`not a target: ${JSON.stringify(target)} (a selector, { role, name }, { text }, { label } or a locator)`);
	};
	const badge = async (text, ms = 900) => {
		await page.evaluate(([t, d]) => {
			const b = document.getElementById('prs-keys');
			if (!b) {
				return;
			}
			b.textContent = t;
			b.style.opacity = '1';
			clearTimeout(b.hideTimer);
			b.hideTimer = setTimeout(() => (b.style.opacity = '0'), d);
		}, [text, ms]);
	};
	const kit = {
		page, app, name,
		/** The element, waited for until it shows. A miss says what the window has that comes closest. */
		async see(target, { timeout = 10_000 } = {}) {
			const loc = locate(target);
			try {
				await loc.waitFor({ state: 'visible', timeout });
			} catch {
				const snap = await kit.probe(`missing-${describe(target).replace(/\W+/g, '-').slice(0, 30)}`);
				const wanted = target?.name ?? target?.text ?? target?.label;
				const near = wanted ? closest(snap.text, wanted) : [];
				const error = new Error(`${describe(target)} did not show within ${timeout / 1000} s.${near.length ? ` Closest: ${near.join(', ')}.` : ''} What the window showed: ${snap.file} (and ${snap.png})`);
				error.probed = true;
				throw error;
			}
			return loc;
		},
		/** Moves the drawn pointer to the element (in steps), rests, clicks, and waits for the result to show. */
		async click(target, { rest = 400, after = 700, dx = 0, dy = 0 } = {}) {
			const loc = await kit.see(target);
			const box = await loc.boundingBox();
			await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 25 });
			await sleep(rest);
			await page.mouse.down();
			await sleep(90);
			await page.mouse.up();
			await sleep(after);
			return loc;
		},
		async hover(target, { rest = 600 } = {}) {
			const loc = await kit.see(target);
			const box = await loc.boundingBox();
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
			await sleep(rest);
			return loc;
		},
		/** Types at a human pace. */
		async type(text, { delay = 60 } = {}) {
			await page.keyboard.type(text, { delay });
		},
		/** Presses keys ('Meta+Shift+P', 'Enter'), shown in a badge. */
		async press(keys, { after = 500 } = {}) {
			await badge(keys.split('+').map(k => KEY_NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k)).join(' '));
			await page.keyboard.press(keys);
			await sleep(after);
		},
		/** Runs a command from the Command Palette, as a user would: F1, its title, Enter. */
		async command(title, { after = 800 } = {}) {
			await kit.press('F1', { after: 300 });
			await kit.see('.quick-input-widget input');
			await kit.type(title, { delay: 35 });
			await kit.see(page.locator('.quick-input-list .monaco-list-row', { hasText: title }).first());
			await kit.press('Enter', { after });
		},
		/** Notes the moment of an action in the recording: ui.footage plays each action at its cue. */
		mark(step) {
			const t = +((Date.now() - since()) / 1000).toFixed(2);
			marks.push({ name: step, t });
			return t;
		},
		/** A screenshot of the whole window, at twice its size: <name>-<label>.png. */
		async shot(label) {
			const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'));
			const file = path.join(out, `${name}-${label}.png`);
			fs.writeFileSync(file, Buffer.from(png, 'base64'));
			return file;
		},
		hold: ms => sleep(ms),
		/** What the window shows now, for finding the right element: its accessibility tree (roles and names) and a shot. */
		async probe(label) {
			const text = await page.locator('body').ariaSnapshot({ timeout: 10_000 }).catch(error => `(no accessibility tree: ${error.message})`);
			const file = path.join(out, `${name}-${label}.probe.txt`);
			fs.writeFileSync(file, text);
			const png = await kit.shot(`${label}.probe`).catch(() => null);
			return { text, file, png };
		},
	};
	return kit;
}
