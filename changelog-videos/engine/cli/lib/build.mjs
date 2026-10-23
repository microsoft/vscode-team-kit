// The VS Code build that has a day's changes, for the demos to record, kept in the home's builds/ folder:
//
// - Insiders by commit: when the installed Insiders is older than the picks, the newest Insiders build, downloaded
//   from the update service (about 300 MB). It runs signed in like the installed one (the same profile and keychain).
// - VS Code built from main: in a release week Insiders is built from the release branch, and changes merged to main
//   are in no build. Then the demos record VS Code built from main as of the last pick, cloned and built here (about
//   8 GB; never in a checkout of yours). It runs as Code OSS: signed in only if the Code OSS profile is.
//
// PRS_BUILDS puts builds elsewhere (a roomier disk). Builds unused for a while are removed by the plugin's setup.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { CACHE as HOME } from './common.mjs';
import { api } from './github.mjs';

const execFileAsync = promisify(execFile);
const REPO = 'microsoft/vscode';
const CACHE = process.env.PRS_BUILDS || path.join(HOME, 'builds');
/** Free space a build from main needs (its checkout, node_modules and the built-in extensions take about 8 GB). */
const MAIN_GB = 12;

/** Where VS Code built from a commit lives: a checkout of it, built, with its own Electron. */
export function sourceBuildDir(commit) {
	return path.join(CACHE, `vscode-${commit.slice(0, 9)}`);
}

const MARKERS = ['.prs-build.json', '.ready'];

/** Marks the build that holds `p` (its folder, or the executable inside it) as used now: the setup removes builds unused
 * for a while. */
export function touchBuild(p) {
	for (let dir = p, up = 0; up < 6 && dir !== path.dirname(dir); dir = path.dirname(dir), up++) {
		const marker = MARKERS.map(m => path.join(dir, m)).find(f => fs.existsSync(f));
		if (marker) {
			const now = new Date();
			fs.utimesSync(marker, now, now);
			return;
		}
	}
}

/** The builds of main done in the cache, the latest commit first: { dir, commit, committedAt, version }. */
export function cachedBuilds() {
	if (!fs.existsSync(CACHE)) {
		return [];
	}
	return fs.readdirSync(CACHE)
		.map(name => path.join(CACHE, name))
		.filter(dir => fs.existsSync(path.join(dir, '.prs-build.json')))
		.map(dir => ({ dir, ...JSON.parse(fs.readFileSync(path.join(dir, '.prs-build.json'), 'utf8')) }))
		.sort((a, b) => String(b.committedAt ?? '').localeCompare(String(a.committedAt ?? '')));
}

/** Free gigabytes on the disk that holds `dir` (or its nearest existing parent), or null when it can't be told. */
export function freeGb(dir) {
	let at = dir;
	while (!fs.existsSync(at)) {
		at = path.dirname(at);
	}
	try {
		const { bavail, bsize } = fs.statfsSync(at);
		return Math.round(bavail * bsize / 1e9);
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------------------------------------------
// Insiders by commit

const PLATFORMS = { 'darwin-arm64': 'darwin-arm64', 'darwin-x64': 'darwin', 'linux-x64': 'linux-x64' };

function platform() {
	const p = PLATFORMS[`${process.platform}-${process.arch}`];
	if (!p) {
		throw new Error(`there are no Insiders builds for ${process.platform} ${process.arch}`);
	}
	return p;
}

/** The executable inside a downloaded build's folder (what PRS_VSCODE takes). */
function exeIn(dir, plat) {
	return plat.startsWith('darwin')
		? path.join(dir, 'Visual Studio Code - Insiders.app', 'Contents', 'MacOS', 'Code - Insiders')
		: path.join(dir, 'VSCode-linux-x64', 'code-insiders');
}

/** Downloads a URL to a file; with curl it resumes and retries (the update server can drop a 300 MB download). */
async function download(url, file) {
	try {
		await execFileAsync('curl', ['-fsSL', '--retry', '5', '--retry-all-errors', '--retry-delay', '2', '-C', '-', '-o', file, url]);
		return;
	} catch (error) {
		if (error.code !== 'ENOENT') {
			throw new Error(`the download failed: ${url}\n${String(error.stderr || error.message).trim()}`);
		}
	}
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`the download failed (${res.status}): ${url}`);
	}
	await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
}

/** Downloads and unpacks an Insiders build once; returns its executable. */
async function fetchInsiders(sha, plat, log) {
	const dir = path.join(CACHE, `insiders-${plat}-${sha.slice(0, 12)}`);
	const ready = path.join(dir, '.ready');
	if (fs.existsSync(ready)) {
		touchBuild(dir);
		return exeIn(dir, plat);
	}
	fs.mkdirSync(dir, { recursive: true });
	log(`downloading VS Code Insiders ${sha.slice(0, 9)} (about 300 MB)...`);
	const archive = path.join(dir, plat.startsWith('darwin') ? 'build.zip' : 'build.tar.gz');
	await download(`https://update.code.visualstudio.com/commit:${sha}/${plat}/insider`, archive);
	if (plat.startsWith('darwin')) {
		fs.rmSync(path.join(dir, 'Visual Studio Code - Insiders.app'), { recursive: true, force: true });
		execFileSync('ditto', ['-x', '-k', archive, dir]);
		try {
			execFileSync('xattr', ['-dr', 'com.apple.quarantine', path.join(dir, 'Visual Studio Code - Insiders.app')]);
		} catch {
			// Not quarantined.
		}
	} else {
		fs.rmSync(path.join(dir, 'VSCode-linux-x64'), { recursive: true, force: true });
		execFileSync('tar', ['-xzf', archive, '-C', dir]);
	}
	fs.rmSync(archive);
	if (!fs.existsSync(exeIn(dir, plat))) {
		throw new Error(`the build unpacked, but ${exeIn(dir, plat)} is missing`);
	}
	fs.writeFileSync(ready, `${sha}\n`);
	return exeIn(dir, plat);
}

/**
 * The newest Insiders build, downloaded, when it has every pick (`has(commit)` says whether a build's commit has
 * them); null when it doesn't (a release week: then no Insiders build has them).
 */
export async function newestInsiders(has, { log = console.log } = {}) {
	const plat = platform();
	const res = await fetch(`https://update.code.visualstudio.com/api/commits/insider/${plat}`);
	if (!res.ok) {
		throw new Error(`the list of Insiders builds failed (${res.status})`);
	}
	const [newest] = await res.json();
	if (!newest || !(await has(newest))) {
		return null;
	}
	return fetchInsiders(newest, plat, log);
}

// ---------------------------------------------------------------------------------------------------------------
// VS Code built from main

/** The last commit on microsoft/vscode main at a time (ISO 8601). */
export async function mainAt(time) {
	const commits = await api(`repos/${REPO}/commits?sha=main&until=${encodeURIComponent(time)}&per_page=1`);
	if (!commits?.[0]?.sha) {
		throw new Error(`No commit on ${REPO} main before ${time}`);
	}
	return { sha: commits[0].sha, date: commits[0].commit.committer.date, message: commits[0].commit.message.split('\n')[0] };
}

function run(command, args, { cwd, log }) {
	return new Promise((resolve, reject) => {
		fs.appendFileSync(log, `\n$ ${command} ${args.join(' ')}\n`);
		const out = fs.openSync(log, 'a');
		const child = spawn(command, args, { cwd, stdio: ['ignore', out, out], env: { ...process.env, CI: process.env.CI ?? '' } });
		child.on('error', reject);
		child.on('close', code => {
			fs.closeSync(out);
			if (code === 0) {
				resolve();
			} else {
				const tail = fs.readFileSync(log, 'utf8').split('\n').slice(-30).join('\n');
				reject(new Error(`${command} ${args.join(' ')} failed (${code}). The end of ${log}:\n${tail}`));
			}
		});
	});
}

/**
 * Builds VS Code at a commit of main (default: main at `at`, or now) and returns its folder. A build that is done is
 * reused. Takes a while the first time: the checkout, npm ci, the client, extensions and Copilot (build-fast), then
 * Electron and the built-in extensions (preLaunch).
 */
export async function buildFromSource({ commit = null, at = null, log = console.log } = {}) {
	const target = commit ? { sha: commit, date: null, message: '' } : await mainAt(at ?? new Date().toISOString());
	if (!/^[0-9a-f]{40}$/.test(target.sha)) {
		throw new Error(`A commit is its full 40-character SHA: ${target.sha}`);
	}
	const dir = sourceBuildDir(target.sha);
	const done = path.join(dir, '.prs-build.json');
	if (fs.existsSync(done)) {
		touchBuild(dir);
		log(`VS Code ${target.sha.slice(0, 9)} is built: ${dir}`);
		return dir;
	}
	const free = freeGb(CACHE);
	if (free !== null && free < MAIN_GB) {
		throw new Error(`building VS Code from main needs about ${MAIN_GB} GB free in ${CACHE}, and there are ${free} GB (PRS_BUILDS puts builds on another disk)`);
	}
	fs.mkdirSync(dir, { recursive: true });
	const logFile = path.join(dir, '.prs-build.log');
	const step = async (label, command, args) => {
		const t0 = Date.now();
		log(`${label}...`);
		await run(command, args, { cwd: dir, log: logFile });
		log(`  ${label}: ${((Date.now() - t0) / 60000).toFixed(1)} min`);
	};
	log(`Building VS Code ${target.sha.slice(0, 9)}${target.message ? ` (${target.message})` : ''} in ${dir} (log: ${logFile})`);
	if (!fs.existsSync(path.join(dir, '.git'))) {
		await step('checkout', 'git', ['init', '-q']);
		await run('git', ['remote', 'add', 'origin', `https://github.com/${REPO}.git`], { cwd: dir, log: logFile });
	}
	await step('fetch', 'git', ['fetch', '-q', '--depth', '1', 'origin', target.sha]);
	await run('git', ['checkout', '-q', '--force', 'FETCH_HEAD'], { cwd: dir, log: logFile });
	await step('npm ci', 'npm', ['ci']);
	await step('build (client, extensions, Copilot)', 'npm', ['run', 'build-fast']);
	await step('Electron and the built-in extensions', 'node', ['build/lib/preLaunch.ts']);
	const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
	fs.writeFileSync(done, JSON.stringify({ commit: target.sha, committedAt: target.date, version: pkg.version, builtAt: new Date().toISOString() }, null, '\t'));
	log(`VS Code ${pkg.version} (${target.sha.slice(0, 9)}) is built: ${dir}`);
	return dir;
}
