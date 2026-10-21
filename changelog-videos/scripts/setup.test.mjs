// The setup of the changelog-videos engine: a copy per engine version, packages installed once per lock file, the work
// and the current copy linked, and only what the home no longer needs removed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AGE, copyState, engineFiles, filesHash, homeDir, isMain, ready, stale } from './setup.mjs';

/** A small engine in a temp folder, and an install that writes a marker instead of running npm. */
function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cvid-setup-'));
	const source = path.join(root, 'engine'), home = path.join(root, 'home');
	for (const [f, text] of Object.entries({ 'cli/prs.mjs': '// prs\n', 'digest/player.js': '// player\n', 'package.json': '{}\n', 'package-lock.json': '{"lockfileVersion":3}\n', 'videos/.keep': '' })) {
		fs.mkdirSync(path.dirname(path.join(source, f)), { recursive: true });
		fs.writeFileSync(path.join(source, f), text);
	}
	let installs = 0;
	const install = dir => {
		installs++;
		fs.mkdirSync(path.join(dir, 'node_modules', 'esbuild'), { recursive: true });
	};
	const setUp = () => {
		const files = engineFiles(source);
		const hash = filesHash(source, files);
		const dir = path.join(home, 'engine', hash);
		ready(home, dir, hash, files, { source, install });
		return { dir, hash };
	};
	return { root, source, home, setUp, installs: () => installs };
}

test('the home is ~/.cache/changelog-videos unless CHANGELOG_VIDEOS_HOME moves it', () => {
	assert.deepStrictEqual([homeDir({}, '/Users/me'), homeDir({ CHANGELOG_VIDEOS_HOME: '/tmp/cv' }, '/Users/me')], ['/Users/me/.cache/changelog-videos', '/tmp/cv']);
});

test('the setup runs when node runs it through a link to its folder (macOS\'s /tmp), and not when it is imported', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cvid-main-'));
	try {
		const script = path.join(root, 'real', 'setup.mjs');
		fs.mkdirSync(path.dirname(script));
		fs.writeFileSync(script, '');
		fs.symlinkSync(path.join(root, 'real'), path.join(root, 'link'), 'dir');
		const url = pathToFileURL(fs.realpathSync(script)).href;
		assert.deepStrictEqual(
			[isMain(script, url), isMain(path.join(root, 'link', 'setup.mjs'), url), isMain(path.join(root, 'real', 'other.mjs'), url), isMain(undefined, url)],
			[true, true, false, false]);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

test('a copy per engine version, its videos/ and node_modules linked, the packages installed once', () => {
	const f = fixture();
	try {
		const first = f.setUp();
		const again = f.setUp();
		fs.writeFileSync(path.join(f.source, 'digest', 'player.js'), '// player, changed\n');
		const changed = f.setUp();
		assert.deepStrictEqual({
			files: engineFiles(f.source),
			same: first.dir === again.dir,
			newCopy: changed.dir !== first.dir,
			ready: copyState(changed.dir, changed.hash),
			videos: fs.readlinkSync(path.join(changed.dir, 'videos')),
			current: fs.readlinkSync(path.join(f.home, 'current')),
			installs: f.installs(),
		}, {
			files: ['cli/prs.mjs', 'digest/player.js', 'package-lock.json', 'package.json'],
			same: true,
			newCopy: true,
			ready: 'ready',
			videos: path.join(f.home, 'work', 'videos'),
			current: changed.dir,
			installs: 1,
		});
	} finally {
		fs.rmSync(f.root, { recursive: true, force: true });
	}
});

test('the home keeps what is in use: old copies, the frames of old work and unused builds go, sources stay', () => {
	const f = fixture();
	try {
		const old = f.setUp();
		fs.writeFileSync(path.join(f.source, 'digest', 'player.js'), '// player, changed\n');
		const current = f.setUp();
		const now = Date.now();
		const ago = (p, ms) => fs.utimesSync(p, new Date(now - ms), new Date(now - ms));
		ago(path.join(old.dir, '.setup-ready'), AGE.copy + 1000);
		// A project untouched for over a week (its recording frames go; its sources stay) and a fresh one.
		const work = path.join(f.home, 'work', 'videos');
		for (const slug of ['changelog-2026-10-01', 'changelog-2026-10-21']) {
			fs.mkdirSync(path.join(work, slug, 'build', 'demos', 'c1', 'frames'), { recursive: true });
			fs.writeFileSync(path.join(work, slug, 'digest.json'), '{}');
		}
		ago(path.join(work, 'changelog-2026-10-01'), AGE.frames + 1000);
		// Builds: of main, unused for four days and used today; an Insiders download used last week; a partial one.
		const builds = path.join(f.home, 'builds');
		const make = (name, marker, age) => {
			fs.mkdirSync(path.join(builds, name), { recursive: true });
			if (marker) {
				fs.writeFileSync(path.join(builds, name, marker), '{}');
				ago(path.join(builds, name, marker), age);
			} else {
				ago(path.join(builds, name), age);
			}
		};
		make('vscode-aaaaaaaaa', '.prs-build.json', AGE.main + 1000);
		make('vscode-bbbbbbbbb', '.prs-build.json', 1000);
		make('insiders-darwin-arm64-cccccccccccc', '.ready', 7 * 24 * 3600 * 1000);
		make('insiders-darwin-arm64-dddddddddddd', null, AGE.partial + 1000);
		assert.deepStrictEqual(stale(f.home, current.dir, now).map(p => path.relative(f.home, p)).sort(), [
			'builds/insiders-darwin-arm64-dddddddddddd',
			'builds/vscode-aaaaaaaaa',
			path.join('engine', path.basename(old.dir)),
			'work/videos/changelog-2026-10-01/build/demos/c1/frames',
		].sort());
	} finally {
		fs.rmSync(f.root, { recursive: true, force: true });
	}
});
