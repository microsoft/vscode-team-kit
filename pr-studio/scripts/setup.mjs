#!/usr/bin/env node
// Gets the pr-studio engine ready and prints its folder as the last line: STUDIO=<folder>.
//
// The engine is the studio/ folder of this plugin. The first run of a version copies it into
// ~/.cache/pr-studio/engine/<hash of its files>/ and links its npm packages, installed once per package-lock.json into
// ~/.cache/pr-studio/deps/<hash>/; later runs find the copy ready and return at once. Videos and decks are made in
// ~/.cache/pr-studio/work/ (each copy's videos/ and decks/ link there), so an engine update keeps them. Render caches of
// work untouched for a week, engine copies not used for a day and packages no copy uses are removed (finished videos
// and decks are delivered to ~/Downloads, outside the cache). Built-in Node modules only: this runs before anything is
// installed. PRS_HOME moves ~/.cache/pr-studio.
//
// Usage: node setup.mjs

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The engine that ships with the plugin. */
export const SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'studio');

/** Written last, once a copy (or an install) succeeded: its hash. */
const READY_FILE = '.setup-ready';

/** An engine copy not used for this long (set up, or run: prs marks its copy) is removed; render caches of work untouched
 * for this long too. */
const COPY_MS = 24 * 60 * 60 * 1000;
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;

/** A video or deck in an older engine copy changed this recently may still be in use by a session of that engine: it
 * stays where it is until it is idle. */
const IDLE_MS = 60 * 60 * 1000;

/** The folders of a video or deck that can be made again from its sources. */
const CACHES = ['build/cache', 'build/frames', 'build/footage'];

/** What the engine copies leave out. */
const SKIP = new Set(['node_modules', '.DS_Store', '__pycache__', 'out', 'videos', 'decks']);

/** Where settings, the history, the work and the engine copies live. */
export function stateDir(env = process.env, home = os.homedir()) {
	return env.PRS_HOME ? path.resolve(env.PRS_HOME) : path.join(home, '.cache', 'pr-studio');
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

/** The partial folders that runs no longer alive left next to `dir` (a run that was stopped mid-install). */
export function stalePartials(dir, isRunning = isProcessRunning) {
	const parent = path.dirname(dir);
	if (!fs.existsSync(parent)) {
		return [];
	}
	return fs.readdirSync(parent)
		.map(name => /^(?<base>.+)\.partial-(?<pid>\d+)$/.exec(name))
		.filter(m => m && !isRunning(Number(m.groups.pid)))
		.map(m => path.join(parent, m[0]));
}

/** Builds `dir` with `make(partial)` next to it and moves it into place at the end, so an interrupted run never leaves
 * a folder that looks ready. Another run may finish first: then its folder is kept. */
function build(dir, hash, make) {
	if (copyState(dir, hash) === 'ready') {
		return;
	}
	for (const stale of stalePartials(dir)) {
		fs.rmSync(stale, { recursive: true, force: true });
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

/** The engine's npm packages, installed once per package-lock.json (which pins every one of them): their folder. */
export function ensureDeps(state, source = SOURCE) {
	const files = ['package.json', 'package-lock.json'];
	const hash = filesHash(source, ['package-lock.json']);
	const dir = path.join(state, 'deps', hash);
	// Marked ready but without its packages (removed by hand, or by a run of another version meanwhile): install again.
	if (copyState(dir, hash) === 'ready' && !fs.existsSync(path.join(dir, 'node_modules'))) {
		fs.rmSync(path.join(dir, READY_FILE), { force: true });
	}
	if (copyState(dir, hash) !== 'ready') {
		console.error(`Installing the pr-studio packages (${hash}) in ${dir}: first time for these versions only...`);
	}
	build(dir, hash, partial => {
		for (const f of files) {
			fs.copyFileSync(path.join(source, f), path.join(partial, f));
		}
		run('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], partial);
	});
	return dir;
}

/** The videos and decks made inside an engine copy before the work moved out: `<copy>/videos/<slug>` in a real folder,
 * not a link. Hidden files are not work. */
function legacyWork(copy) {
	const out = [];
	for (const kind of ['videos', 'decks']) {
		const legacy = path.join(copy, kind);
		let isFolder = false;
		try {
			isFolder = fs.lstatSync(legacy).isDirectory();
		} catch {
			// No such folder.
		}
		if (isFolder) {
			out.push(...fs.readdirSync(legacy).filter(slug => !slug.startsWith('.')).map(slug => ({ kind, slug, from: path.join(legacy, slug) })));
		}
	}
	return out;
}

/** `to`, or the first free `<to>~<copy>`, `<to>~<copy>-2`... */
function freeName(to, copy) {
	if (!fs.existsSync(to)) {
		return to;
	}
	for (let n = 1; ; n++) {
		const candidate = `${to}~${copy}${n > 1 ? `-${n}` : ''}`;
		if (!fs.existsSync(candidate)) {
			return candidate;
		}
	}
}

/** Moves the videos and decks made inside older engine copies (before the work moved out) into `work`. A slug found in
 * several copies keeps its plain name for its fullest version (a storyboard or a deck, not only a fetched PR), then its
 * newest; the others are kept beside it as `<slug>~<copy>`: nothing made is lost. A slug changed in the last hour waits:
 * a session of that engine may still be making it. */
export function migrateWork(state, now = Date.now(), idle = IDLE_MS) {
	const root = path.join(state, 'engine');
	const groups = new Map();
	for (const copy of fs.existsSync(root) ? fs.readdirSync(root).sort() : []) {
		for (const item of legacyWork(path.join(root, copy))) {
			const key = `${item.kind}/${item.slug}`;
			groups.set(key, [...(groups.get(key) ?? []), { ...item, copy }]);
		}
	}
	const moved = [];
	for (const items of groups.values()) {
		let ranked;
		try {
			ranked = items.map(item => ({ ...item, changed: lastChange(item.from), made: isMade(item) }));
		} catch (error) {
			// Another run moved one first.
			if (error.code === 'ENOENT') {
				continue;
			}
			throw error;
		}
		if (ranked.some(item => now - item.changed < idle)) {
			continue;
		}
		ranked.sort((a, b) => Number(b.made) - Number(a.made) || b.changed - a.changed);
		for (const { kind, slug, from, copy } of ranked) {
			try {
				fs.mkdirSync(path.join(state, 'work', kind), { recursive: true });
				const to = freeName(path.join(state, 'work', kind, slug), copy);
				fs.renameSync(from, to);
				moved.push(to);
			} catch (error) {
				if (error.code !== 'ENOENT') {
					throw error;
				}
			}
		}
	}
	return moved;
}

/** Whether a video or deck folder holds work, not only a fetched PR. */
function isMade({ kind, from }) {
	return fs.existsSync(path.join(from, kind === 'videos' ? 'storyboard.json' : 'deck.mjs'));
}

/** When a file or folder last changed: its newest entry, looking two levels in (a video's sources, and build/). Entries
 * that go away meanwhile (a render renaming its files) don't count. */
function lastChange(p) {
	const st = fs.lstatSync(p);
	let latest = st.mtimeMs;
	if (!st.isDirectory()) {
		return latest;
	}
	const stat = file => {
		try {
			return fs.lstatSync(file);
		} catch {
			return null;
		}
	};
	for (const name of fs.readdirSync(p)) {
		const child = path.join(p, name);
		const cst = stat(child);
		if (!cst) {
			continue;
		}
		latest = Math.max(latest, cst.mtimeMs);
		if (cst.isDirectory()) {
			try {
				for (const inner of fs.readdirSync(child)) {
					latest = Math.max(latest, stat(path.join(child, inner))?.mtimeMs ?? 0);
				}
			} catch {
				// It went away.
			}
		}
	}
	return latest;
}

/** The render caches of work untouched for `age`: folders to remove. */
export function staleCaches(state, now = Date.now(), age = CACHE_MS) {
	const out = [];
	for (const kind of ['videos', 'decks']) {
		const root = path.join(state, 'work', kind);
		for (const slug of fs.existsSync(root) ? fs.readdirSync(root) : []) {
			const dir = path.join(root, slug);
			try {
				if (!fs.statSync(dir).isDirectory() || now - lastChange(dir) < age) {
					continue;
				}
			} catch {
				// It went away.
				continue;
			}
			out.push(...CACHES.map(c => path.join(dir, c)).filter(c => fs.existsSync(c)));
		}
	}
	return out;
}

/** The engine copies to remove: every ready copy but `current` that was not used in the last day (another session
 * may still be making a video or a deck with it) and holds no work of its own that is still to move out. */
export function oldCopies(root, current, now = Date.now(), age = COPY_MS) {
	if (!fs.existsSync(root)) {
		return [];
	}
	return fs.readdirSync(root)
		.filter(name => !name.includes('.partial-') && fs.existsSync(path.join(root, name, READY_FILE)))
		.map(name => path.join(root, name))
		.filter(dir => dir !== current && now - fs.statSync(path.join(dir, READY_FILE)).mtimeMs > age && !legacyWork(dir).length);
}

/** The package installs no engine copy links to, and that no run set up in the last day (one may be linking it). */
export function unusedDeps(state, now = Date.now(), age = COPY_MS) {
	const used = new Set();
	const root = path.join(state, 'engine');
	for (const name of fs.existsSync(root) ? fs.readdirSync(root) : []) {
		try {
			used.add(path.dirname(fs.readlinkSync(path.join(root, name, 'node_modules'))));
		} catch {
			// A copy from before the shared packages, or a partial one.
		}
	}
	const deps = path.join(state, 'deps');
	return (fs.existsSync(deps) ? fs.readdirSync(deps) : [])
		.filter(name => !name.includes('.partial-'))
		.map(name => path.join(deps, name))
		.filter(dir => !used.has(dir) && !(fs.existsSync(path.join(dir, READY_FILE)) && now - fs.statSync(path.join(dir, READY_FILE)).mtimeMs < age));
}

function isProcessRunning(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === 'EPERM';
	}
}

/** Points the link `at` to `target`, replacing an old link in one step (a session may be using it). */
export function link(target, at) {
	try {
		if (fs.readlinkSync(at) === target) {
			return;
		}
	} catch {
		// Not a link yet.
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

function fail(message) {
	console.error(`setup: ${message}`);
	process.exit(1);
}

function run(command, args, cwd) {
	try {
		execFileSync(command, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
	} catch (error) {
		throw new Error(error.code === 'ENOENT' ? `${command} is not installed` : `${command} ${args.join(' ')} failed`);
	}
}

/** Removes what the cache no longer needs; never the current copy, its packages, or any video or deck source. */
function tidy(state, current) {
	for (const moved of migrateWork(state)) {
		console.error(`Moved ${moved} out of an older engine copy`);
	}
	for (const old of oldCopies(path.join(state, 'engine'), current)) {
		fs.rmSync(old, { recursive: true, force: true });
		console.error(`Removed an older engine copy: ${old}`);
	}
	for (const deps of unusedDeps(state)) {
		fs.rmSync(deps, { recursive: true, force: true });
		console.error(`Removed packages no engine copy uses: ${deps}`);
	}
	for (const cache of staleCaches(state)) {
		fs.rmSync(cache, { recursive: true, force: true });
		console.error(`Removed a render cache untouched for a week: ${cache}`);
	}
}

function main() {
	if (process.platform === 'win32') {
		fail('pr-studio runs on macOS and Linux for now');
	}
	if (Number(process.versions.node.split('.')[0]) < 20) {
		fail(`pr-studio needs Node.js 20 or newer; this is ${process.version}`);
	}
	if (!fs.existsSync(path.join(SOURCE, 'cli', 'prs.mjs'))) {
		fail(`the engine is missing from the plugin (${SOURCE})`);
	}
	const state = stateDir();
	const files = engineFiles(SOURCE);
	const hash = filesHash(SOURCE, files);
	const dir = path.join(state, 'engine', hash);
	// Twice at most: the setup of another version may remove an old copy of this one while this run picks it up.
	for (let attempt = 1; ; attempt++) {
		try {
			ready(state, dir, hash, files);
			break;
		} catch (error) {
			if (error.code !== 'ENOENT' || attempt > 1) {
				fail(error.message);
			}
		}
	}
	try {
		tidy(state, dir);
	} catch (error) {
		console.error(`setup: could not tidy the cache (${error.message}); the engine is ready`);
	}
	console.log(`STUDIO=${dir}`);
}

/** Makes the copy `dir` ready, with its packages and work folders, and marks both as in use now, before the cache is
 * tidied, so no run removes them while this session uses them. */
function ready(state, dir, hash, files) {
	if (copyState(dir, hash) !== 'ready') {
		const deps = ensureDeps(state);
		console.error(`Setting up the pr-studio engine (${hash}) in ${dir}...`);
		build(dir, hash, partial => {
			for (const f of files) {
				const out = path.join(partial, ...f.split('/'));
				fs.mkdirSync(path.dirname(out), { recursive: true });
				fs.copyFileSync(path.join(SOURCE, ...f.split('/')), out);
			}
			fs.symlinkSync(path.join(deps, 'node_modules'), path.join(partial, 'node_modules'), 'dir');
			for (const kind of ['videos', 'decks']) {
				fs.symlinkSync(path.join(state, 'work', kind), path.join(partial, kind), 'dir');
			}
		});
	}
	const now = new Date();
	fs.utimesSync(path.join(dir, READY_FILE), now, now);
	// A ready copy whose packages or work folders went meanwhile gets them back.
	if (!fs.existsSync(path.join(dir, 'node_modules'))) {
		link(path.join(ensureDeps(state), 'node_modules'), path.join(dir, 'node_modules'));
	}
	const modules = fs.readlinkSync(path.join(dir, 'node_modules'));
	if (fs.existsSync(path.join(path.dirname(modules), READY_FILE))) {
		fs.utimesSync(path.join(path.dirname(modules), READY_FILE), now, now);
	}
	for (const kind of ['videos', 'decks']) {
		fs.mkdirSync(path.join(state, 'work', kind), { recursive: true });
	}
	// Scripts kept with the work (a capture script in footage/ or assets/) find the engine's packages.
	link(modules, path.join(state, 'work', 'node_modules'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
