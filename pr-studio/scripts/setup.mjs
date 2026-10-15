#!/usr/bin/env node
// Gets the pr-studio engine ready and prints its folder as the last line: STUDIO=<folder>.
//
// The engine ships with this plugin, packed into engine.pack next to this script (made by `npm run plugin` in
// https://github.com/federicobrancasi/pr-studio, where this script's source and tests are too). The first run unpacks
// it into ~/.cache/pr-studio/engine/<hash of the pack>/ and installs its npm packages there; later runs find that folder
// ready and return at once. An updated engine gets a new folder, and only the newest three copies are kept (finished
// videos and decks are delivered to ~/Downloads, outside them). Built-in Node modules only: this runs before anything
// is installed. PRS_HOME moves ~/.cache/pr-studio.
//
// Usage: node setup.mjs

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The engine that ships with the plugin. */
export const SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'engine.pack');

/** Written last, once the copy and the install succeeded: the hash of the engine it holds. */
const READY_FILE = '.setup-ready';

/** How many engine copies to keep, and how long a copy that was used stays whatever the count. */
const KEEP = 3;
const RECENT_MS = 24 * 60 * 60 * 1000;

/** Where settings, the history and the engine copies live. */
export function stateDir(env = process.env, home = os.homedir()) {
	return env.PRS_HOME ? path.resolve(env.PRS_HOME) : path.join(home, '.cache', 'pr-studio');
}

/**
 * The files of a pack, as [{ path, data }]. A pack is text: comment lines (#) at the top, then for each file a header
 * line `==> <path>  <text|base64> <bytes>`, exactly that many bytes, and a newline. Binary files are in base64, wrapped.
 */
export function readPack(buffer) {
	const files = [];
	let at = 0;
	const line = () => {
		const end = buffer.indexOf(10, at);
		const text = buffer.toString('utf8', at, end < 0 ? buffer.length : end);
		at = end < 0 ? buffer.length : end + 1;
		return text;
	};
	while (at < buffer.length) {
		const head = line();
		if (head.startsWith('#') || (!files.length && !head.startsWith('==> '))) {
			continue;
		}
		const m = /^==> (?<path>\S+) {2}(?<kind>text|base64) (?<bytes>\d+)$/.exec(head);
		if (!m) {
			throw new Error(`not a pack: unexpected line "${head.slice(0, 80)}"`);
		}
		const rel = m.groups.path;
		if (path.isAbsolute(rel) || rel.split('/').some(part => part === '..' || part === '')) {
			throw new Error(`not a pack: unsafe path "${rel}"`);
		}
		const bytes = Number(m.groups.bytes);
		const body = buffer.subarray(at, at + bytes);
		if (body.length !== bytes || buffer[at + bytes] !== 10) {
			throw new Error(`not a pack: ${rel} is cut short`);
		}
		at += bytes + 1;
		files.push({ path: rel, data: m.groups.kind === 'base64' ? Buffer.from(body.toString('ascii').replace(/\s+/g, ''), 'base64') : Buffer.from(body) });
	}
	return files;
}

/** Writes the files of a pack under `dir`. */
export function unpack(buffer, dir) {
	const files = readPack(buffer);
	for (const f of files) {
		const out = path.join(dir, ...f.path.split('/'));
		fs.mkdirSync(path.dirname(out), { recursive: true });
		fs.writeFileSync(out, f.data);
	}
	return files.length;
}

/** A short hash of the pack: a new engine gets a new folder. */
export function packHash(buffer) {
	return crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12);
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

/** When a copy was last used: its setup, or the newest change to a video or deck made in it (one level into each). */
export function lastUsed(dir) {
	let latest = fs.statSync(path.join(dir, READY_FILE)).mtimeMs;
	for (const work of ['videos', 'decks']) {
		const root = path.join(dir, work);
		for (const slug of fs.existsSync(root) ? fs.readdirSync(root) : []) {
			const folder = path.join(root, slug);
			for (const name of ['', ...(fs.statSync(folder).isDirectory() ? fs.readdirSync(folder) : [])]) {
				latest = Math.max(latest, fs.statSync(path.join(folder, name)).mtimeMs);
			}
		}
	}
	return latest;
}

/**
 * The engine copies to remove: every ready copy but the newest `keep` (by when they were last used), never `current`,
 * and never one used in the last day: another session may still be making a video or a deck in it.
 */
export function oldCopies(root, current, keep = KEEP, now = Date.now()) {
	if (!fs.existsSync(root)) {
		return [];
	}
	const copies = fs.readdirSync(root)
		.filter(name => !name.includes('.partial-') && fs.existsSync(path.join(root, name, READY_FILE)))
		.map(name => ({ dir: path.join(root, name), used: lastUsed(path.join(root, name)) }))
		.sort((a, b) => b.used - a.used);
	return copies.slice(keep).filter(c => c.dir !== current && now - c.used > RECENT_MS).map(c => c.dir);
}

function isProcessRunning(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === 'EPERM';
	}
}

function fail(message) {
	console.error(`setup: ${message}`);
	process.exit(1);
}

function done(dir) {
	// Mark the copy as used now, so the newest copies are the ones kept.
	const marker = path.join(dir, READY_FILE);
	const now = new Date();
	fs.utimesSync(marker, now, now);
	console.log(`STUDIO=${dir}`);
	process.exit(0);
}

function run(command, args, cwd) {
	try {
		execFileSync(command, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
	} catch (error) {
		throw new Error(error.code === 'ENOENT' ? `${command} is not installed` : `${command} ${args.join(' ')} failed`);
	}
}

function main() {
	if (process.platform === 'win32') {
		fail('pr-studio runs on macOS and Linux for now');
	}
	if (Number(process.versions.node.split('.')[0]) < 20) {
		fail(`pr-studio needs Node.js 20 or newer; this is ${process.version}`);
	}
	if (!fs.existsSync(SOURCE)) {
		fail(`the engine is missing from the plugin (${SOURCE})`);
	}

	const pack = fs.readFileSync(SOURCE);
	const hash = packHash(pack);
	const root = path.join(stateDir(), 'engine');
	const dir = path.join(root, hash);
	if (copyState(dir, hash) === 'ready') {
		done(dir);
	}

	for (const stale of stalePartials(dir)) {
		fs.rmSync(stale, { recursive: true, force: true });
	}
	// Build the copy next to its final place and move it there at the end, so an interrupted run never leaves a folder
	// that looks ready.
	const partial = `${dir}.partial-${process.pid}`;
	console.error(`Setting up the pr-studio engine (${hash}) in ${dir}: first time for this version only...`);
	try {
		unpack(pack, partial);
		run('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], partial);
		fs.writeFileSync(path.join(partial, READY_FILE), `${hash}\n`);
	} catch (error) {
		fs.rmSync(partial, { recursive: true, force: true });
		fail(error.message);
	}

	if (copyState(dir, hash) === 'ready') {
		// Another run finished first.
		fs.rmSync(partial, { recursive: true, force: true });
		done(dir);
	}
	fs.rmSync(dir, { recursive: true, force: true });
	fs.renameSync(partial, dir);
	for (const old of oldCopies(root, dir)) {
		fs.rmSync(old, { recursive: true, force: true });
		console.error(`Removed an older engine copy: ${old}`);
	}
	done(dir);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
