#!/usr/bin/env node
// Gets the changelog-videos engine ready and prints its folder as the last line: ENGINE=<folder>.
//
// The engine is the engine/ folder of this plugin. The first run of a version copies it into
// ~/.cache/changelog-videos/engine/<hash of its files>/ and links its npm packages, installed once per
// package-lock.json into ~/.cache/changelog-videos/deps/<hash>/; later runs find the copy ready and return at once.
// Videos are made in ~/.cache/changelog-videos/work/videos/ (each copy's videos/ links there), so an engine update
// keeps them, and current/ links to the copy set up last. It removes what the home no longer needs: engine copies not
// used for a day, packages no copy uses, the recording frames of work untouched for a week, Insiders builds unused
// for two weeks and builds of VS Code from main (about 8 GB each) unused for three days. Finished videos are delivered
// to ~/Downloads, outside the home. Built-in Node modules only: this runs before anything is installed.
// CHANGELOG_VIDEOS_HOME moves the home.
//
// Usage: node setup.mjs

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The engine that ships with the plugin. */
export const SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'engine');

/** Written last, once a copy (or an install) succeeded: its hash. */
const READY_FILE = '.setup-ready';

const DAY = 24 * 60 * 60 * 1000;
/** How long what the home keeps may go unused before it is removed. */
export const AGE = { copy: DAY, frames: 7 * DAY, insiders: 14 * DAY, main: 3 * DAY, partial: DAY };

/** What the engine copies leave out. */
const SKIP = new Set(['node_modules', 'videos', '.DS_Store', '__pycache__']);

/** Where settings, the voice, the builds, the work and the engine copies live. */
export function homeDir(env = process.env, home = os.homedir()) {
	return env.CHANGELOG_VIDEOS_HOME ? path.resolve(env.CHANGELOG_VIDEOS_HOME) : path.join(home, '.cache', 'changelog-videos');
}

/** The engine's files, as sorted relative paths with '/'. */
export function engineFiles(dir) {
	const out = [];
	const walk = rel => {
		for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
			if (SKIP.has(entry.name)) {
				continue;
			}
			const child = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				walk(child);
			} else if (entry.isFile()) {
				out.push(child);
			}
		}
	};
	walk('');
	return out.sort();
}

/** A short hash of files under `dir` (their paths and contents): a new engine gets a new folder. */
export function filesHash(dir, files) {
	const h = crypto.createHash('sha256');
	for (const f of files) {
		h.update(`${f}\0`);
		h.update(fs.readFileSync(path.join(dir, f)));
		h.update('\0');
	}
	return h.digest('hex').slice(0, 12);
}

/** 'ready', 'missing', or 'incomplete' (a folder without the ready marker for this hash). */
export function copyState(dir, hash) {
	if (!fs.existsSync(dir)) {
		return 'missing';
	}
	try {
		return fs.readFileSync(path.join(dir, READY_FILE), 'utf8').trim() === hash ? 'ready' : 'incomplete';
	} catch {
		return 'incomplete';
	}
}

function isProcessRunning(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === 'EPERM';
	}
}

/** Builds `dir` with `make(partial)` next to it and moves it into place at the end, so an interrupted run never leaves a
 * folder that looks ready. Another run may finish first: then its folder is kept. */
function build(dir, hash, make) {
	if (copyState(dir, hash) === 'ready') {
		return;
	}
	const parent = path.dirname(dir);
	fs.mkdirSync(parent, { recursive: true });
	for (const name of fs.readdirSync(parent)) {
		const m = /^(?<base>.+)\.partial-(?<pid>\d+)$/.exec(name);
		if (m && !isProcessRunning(Number(m.groups.pid))) {
			fs.rmSync(path.join(parent, name), { recursive: true, force: true });
		}
	}
	const partial = `${dir}.partial-${process.pid}`;
	fs.rmSync(partial, { recursive: true, force: true });
	fs.mkdirSync(partial, { recursive: true });
	try {
		make(partial);
		fs.writeFileSync(path.join(partial, READY_FILE), `${hash}\n`);
	} catch (error) {
		fs.rmSync(partial, { recursive: true, force: true });
		throw error;
	}
	if (copyState(dir, hash) === 'ready') {
		fs.rmSync(partial, { recursive: true, force: true });
		return;
	}
	fs.rmSync(dir, { recursive: true, force: true });
	fs.renameSync(partial, dir);
}

function run(command, args, cwd) {
	try {
		execFileSync(command, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
	} catch (error) {
		throw new Error(error.code === 'ENOENT' ? `${command} is not installed` : `${command} ${args.join(' ')} failed`);
	}
}

/** The engine's npm packages, installed once per package-lock.json (which pins every one of them): their folder. */
export function ensureDeps(home, source = SOURCE, install = dir => run('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], dir)) {
	const hash = filesHash(source, ['package-lock.json']);
	const dir = path.join(home, 'deps', hash);
	// Marked ready but without its packages (removed by hand): install again.
	if (copyState(dir, hash) === 'ready' && !fs.existsSync(path.join(dir, 'node_modules'))) {
		fs.rmSync(path.join(dir, READY_FILE), { force: true });
	}
	if (copyState(dir, hash) !== 'ready') {
		console.error(`Installing the engine's packages (${hash}) in ${dir}: first time for these versions only...`);
	}
	build(dir, hash, partial => {
		for (const f of ['package.json', 'package-lock.json']) {
			fs.copyFileSync(path.join(source, f), path.join(partial, f));
		}
		install(partial);
	});
	return dir;
}

/** Points the link `at` to `target`, replacing an old link in one step (a session may be using it). */
export function link(target, at) {
	try {
		if (fs.readlinkSync(at) === target) {
			return;
		}
	} catch {
		// No link yet.
	}
	const temp = `${at}.link-${process.pid}`;
	fs.rmSync(temp, { force: true });
	fs.symlinkSync(target, temp, 'dir');
	try {
		fs.renameSync(temp, at);
	} catch (error) {
		fs.rmSync(temp, { force: true });
		throw error;
	}
}

/** Makes the copy `dir` ready, with its packages and its videos/ linked to the work, and marks both as in use now. */
export function ready(home, dir, hash, files, { source = SOURCE, install } = {}) {
	fs.mkdirSync(path.join(home, 'work', 'videos'), { recursive: true });
	if (copyState(dir, hash) !== 'ready') {
		const deps = ensureDeps(home, source, install);
		console.error(`Setting up the changelog-videos engine (${hash}) in ${dir}...`);
		build(dir, hash, partial => {
			for (const f of files) {
				const out = path.join(partial, ...f.split('/'));
				fs.mkdirSync(path.dirname(out), { recursive: true });
				fs.copyFileSync(path.join(source, ...f.split('/')), out);
			}
			fs.symlinkSync(path.join(deps, 'node_modules'), path.join(partial, 'node_modules'), 'dir');
			fs.symlinkSync(path.join(home, 'work', 'videos'), path.join(partial, 'videos'), 'dir');
		});
	}
	const now = new Date();
	fs.utimesSync(path.join(dir, READY_FILE), now, now);
	const deps = path.dirname(fs.readlinkSync(path.join(dir, 'node_modules')));
	if (fs.existsSync(path.join(deps, READY_FILE))) {
		fs.utimesSync(path.join(deps, READY_FILE), now, now);
	}
	link(dir, path.join(home, 'current'));
}

const mtime = file => fs.statSync(file).mtimeMs;

/** What the home no longer needs (paths to remove): never the current copy, its packages, or any video's sources. */
export function stale(home, current, now = Date.now()) {
	const out = [];
	const list = dir => (fs.existsSync(dir) ? fs.readdirSync(dir).map(name => path.join(dir, name)) : []);
	// Engine copies other than the current one, not set up in the last day.
	const copies = list(path.join(home, 'engine')).filter(d => !d.includes('.partial-') && fs.existsSync(path.join(d, READY_FILE)));
	const oldCopies = copies.filter(d => d !== current && now - mtime(path.join(d, READY_FILE)) > AGE.copy);
	out.push(...oldCopies);
	// Packages no remaining copy links to, and that no run set up in the last day.
	const used = new Set(copies.filter(d => !oldCopies.includes(d)).map(d => {
		try {
			return path.dirname(fs.readlinkSync(path.join(d, 'node_modules')));
		} catch {
			return null;
		}
	}));
	out.push(...list(path.join(home, 'deps')).filter(d => !d.includes('.partial-') && !used.has(d)
		&& !(fs.existsSync(path.join(d, READY_FILE)) && now - mtime(path.join(d, READY_FILE)) < AGE.copy)));
	// The recording frames of work untouched for a week (recording the demo again makes them).
	for (const project of list(path.join(home, 'work', 'videos'))) {
		try {
			if (now - mtime(project) < AGE.frames) {
				continue;
			}
		} catch {
			continue;
		}
		out.push(...list(path.join(project, 'build', 'demos')).map(d => path.join(d, 'frames')).filter(f => fs.existsSync(f)));
	}
	// Builds: Insiders downloads (.ready) unused for two weeks, builds of main (.prs-build.json) for three days, and
	// partial ones (neither marker) older than a day.
	for (const b of list(path.join(home, 'builds'))) {
		const insiders = path.join(b, '.ready'), main = path.join(b, '.prs-build.json');
		try {
			const age = fs.existsSync(main) ? [mtime(main), AGE.main] : fs.existsSync(insiders) ? [mtime(insiders), AGE.insiders] : [mtime(b), AGE.partial];
			if (now - age[0] > age[1]) {
				out.push(b);
			}
		} catch {
			// Removed meanwhile.
		}
	}
	return out;
}

function fail(message) {
	console.error(`setup: ${message}`);
	process.exit(1);
}

function main() {
	if (process.platform === 'win32') {
		fail('changelog-videos runs on macOS and Linux for now');
	}
	if (Number(process.versions.node.split('.')[0]) < 20) {
		fail(`changelog-videos needs Node.js 20 or newer; this is ${process.version}`);
	}
	if (!fs.existsSync(path.join(SOURCE, 'cli', 'prs.mjs'))) {
		fail(`the engine is missing from the plugin (${SOURCE})`);
	}
	const home = homeDir();
	const files = engineFiles(SOURCE);
	const hash = filesHash(SOURCE, files);
	const dir = path.join(home, 'engine', hash);
	try {
		ready(home, dir, hash, files);
	} catch (error) {
		fail(error.message);
	}
	try {
		for (const p of stale(home, dir)) {
			fs.rmSync(p, { recursive: true, force: true });
			console.error(`Removed what the home no longer needs: ${p}`);
		}
	} catch (error) {
		console.error(`setup: could not tidy the home (${error.message}); the engine is ready`);
	}
	console.log(`ENGINE=${dir}`);
}

/** Whether `script` (what node was asked to run) is this file, also through a link (macOS's /tmp is one). */
export function isMain(script = process.argv[1], url = import.meta.url) {
	try {
		return !!script && fs.realpathSync(script) === fs.realpathSync(fileURLToPath(url));
	} catch {
		return false;
	}
}

if (isMain()) {
	main();
}
