// prs app: the VS Code Insiders builds of a pull request, found by commit and kept in the cache: the oldest build with
// its merge (the after) and, with --before, the newest build without it (the before). Prints the path of each app, to
// give the capture kit. Insiders builds come from microsoft/vscode's main branch only: an open PR has none.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { CACHE, readJson, videoDir } from './common.mjs';
import { api } from './github.mjs';

const execFileAsync = promisify(execFile);

const PLATFORMS = { 'darwin-arm64': 'darwin-arm64', 'darwin-x64': 'darwin', 'linux-x64': 'linux-x64' };

function platform() {
	const p = PLATFORMS[`${process.platform}-${process.arch}`];
	if (!p) {
		throw new Error(`there are no Insiders builds for ${process.platform} ${process.arch}`);
	}
	return p;
}

/**
 * The newest build without `merge` and the oldest with it, from the builds listed newest first. `has(build)` says whether
 * a build has the merge in its history; the builds are in order, so a binary search finds the boundary in a few calls.
 */
export async function boundary(builds, has) {
	if (!builds.length || !(await has(builds[0]))) {
		return { after: null, before: builds[0] ?? null };
	}
	let lo = 0, hi = builds.length - 1;
	if (await has(builds[hi])) {
		return { after: builds[hi], before: null };
	}
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (await has(builds[mid])) {
			lo = mid;
		} else {
			hi = mid;
		}
	}
	return { after: builds[lo], before: builds[hi] };
}

/** The app inside a build's folder. */
function appIn(dir, plat) {
	return plat.startsWith('darwin') ? path.join(dir, 'Visual Studio Code - Insiders.app') : path.join(dir, 'VSCode-linux-x64', 'code-insiders');
}

/**
 * Downloads a URL to a file. With curl, it resumes and retries: the update server can drop a download of 300 MB
 * midway. Without curl, fetch tries four times.
 */
async function download(url, file) {
	try {
		await execFileAsync('curl', ['-fsSL', '--retry', '5', '--retry-all-errors', '--retry-delay', '2', '-C', '-', '-o', file, url]);
		return;
	} catch (error) {
		if (error.code !== 'ENOENT') {
			throw new Error(`the download failed: ${url}\n${String(error.stderr || error.message).trim()}`);
		}
	}
	for (let attempt = 1; ; attempt++) {
		try {
			const res = await fetch(url);
			if (!res.ok) {
				throw new Error(`the download failed (${res.status}): ${url}`);
			}
			await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
			return;
		} catch (error) {
			if (attempt === 4) {
				throw error;
			}
			await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
		}
	}
}

/** Downloads and unpacks a build once; later calls return it at once. An interrupted download resumes. */
async function fetchBuild(sha, plat) {
	const dir = path.join(CACHE, 'builds', `${plat}-${sha.slice(0, 12)}`);
	const ready = path.join(dir, '.ready');
	if (fs.existsSync(ready)) {
		const now = new Date();
		fs.utimesSync(ready, now, now);
		return appIn(dir, plat);
	}
	fs.mkdirSync(dir, { recursive: true });
	const url = `https://update.code.visualstudio.com/commit:${sha}/${plat}/insider`;
	console.log(`downloading Insiders ${sha.slice(0, 9)} (about 300 MB)...`);
	const archive = path.join(dir, plat.startsWith('darwin') ? 'build.zip' : 'build.tar.gz');
	await download(url, archive);
	// What an interrupted run may have half unpacked.
	fs.rmSync(plat.startsWith('darwin') ? appIn(dir, plat) : path.dirname(appIn(dir, plat)), { recursive: true, force: true });
	if (plat.startsWith('darwin')) {
		execFileSync('ditto', ['-x', '-k', archive, dir]);
		try {
			execFileSync('xattr', ['-dr', 'com.apple.quarantine', appIn(dir, plat)]);
		} catch {
			// Not quarantined.
		}
	} else {
		execFileSync('tar', ['-xzf', archive, '-C', dir]);
	}
	fs.rmSync(archive);
	if (!fs.existsSync(appIn(dir, plat))) {
		throw new Error(`the build unpacked, but ${appIn(dir, plat)} is missing`);
	}
	fs.writeFileSync(ready, `${sha}\n`);
	return appIn(dir, plat);
}

/** prs app <slug> [--before]: prints AFTER=<app> (and BEFORE=<app>). Returns { after, before } paths. */
export async function app(slug, { before: wantBefore = false } = {}) {
	const { facts } = readJson(path.join(videoDir(slug), 'pr.json'));
	if (facts.repo !== 'microsoft/vscode') {
		throw new Error(`prs app finds VS Code Insiders builds; for ${facts.repo}, build the app with and without the change yourself (shared/capture.md)`);
	}
	if (facts.state !== 'MERGED') {
		throw new Error('this PR isn\'t merged, so no Insiders build has it: build its head (and its base, for a before) from source (shared/capture.md)');
	}
	const merge = (await api(`repos/${facts.repo}/pulls/${facts.number}`)).merge_commit_sha;
	const plat = platform();
	const res = await fetch(`https://update.code.visualstudio.com/api/commits/insider/${plat}`);
	if (!res.ok) {
		throw new Error(`the list of Insiders builds failed (${res.status})`);
	}
	const builds = await res.json();
	let calls = 0;
	const has = async build => {
		calls++;
		const { status } = await api(`repos/${facts.repo}/compare/${merge}...${build}?per_page=1`);
		return status === 'ahead' || status === 'identical';
	};
	const found = await boundary(builds, has);
	if (!found.after) {
		throw new Error(`no Insiders build has this PR yet: the newest (${found.before?.slice(0, 9)}) is from before its merge (${merge.slice(0, 9)}). Wait for the next build, or build it from source.`);
	}
	const out = { merge, after: found.after, before: found.before, checked: calls };
	// Both at once: each is about 300 MB.
	const getBefore = wantBefore && found.before;
	[out.afterApp, out.beforeApp] = await Promise.all([fetchBuild(found.after, plat), getBefore ? fetchBuild(found.before, plat) : undefined]);
	console.log(`after: Insiders ${found.after.slice(0, 9)}, the oldest build with the merge ${merge.slice(0, 9)}`);
	console.log(`AFTER=${out.afterApp}`);
	if (wantBefore) {
		if (!found.before) {
			console.log('before: every listed Insiders build has the change: for a behind-a-setting change, use the after with the setting off; else build its base from source');
		} else {
			console.log(`before: Insiders ${found.before.slice(0, 9)}, the newest build without it`);
			console.log(`BEFORE=${out.beforeApp}`);
		}
	}
	fs.mkdirSync(path.join(videoDir(slug), 'build'), { recursive: true });
	fs.writeFileSync(path.join(videoDir(slug), 'build', 'apps.json'), `${JSON.stringify(out, null, '\t')}\n`);
	return out;
}
