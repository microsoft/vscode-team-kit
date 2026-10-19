// Tests of the plugin's setup: the engine copy, the shared packages, the work folders and what gets pruned.
// Built-in Node modules only, like the setup itself: node --test pr-studio/scripts/setup.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { copyState, engineFiles, filesHash, link, migrateWork, oldCopies, staleBuilds, stalePartials, staleCaches, stateDir, unusedDeps } from './setup.mjs';

function tmp() {
	return fs.mkdtempSync(path.join(os.tmpdir(), 'prs-setup-'));
}

function write(file, text = 'x') {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, text);
}

function age(file, ms) {
	const t = new Date(Date.now() - ms);
	fs.utimesSync(file, t, t);
}

const DAY = 24 * 60 * 60 * 1000;

test('the engine files leave out installs, caches and work, and their hash follows the contents', () => {
	const dir = tmp();
	write(path.join(dir, 'cli', 'prs.mjs'), 'a');
	write(path.join(dir, 'theme', 'studio.css'), 'b');
	write(path.join(dir, 'node_modules', 'x', 'index.js'));
	write(path.join(dir, 'voice', '__pycache__', 'voice.pyc'));
	write(path.join(dir, 'videos', 'demo', 'scenes.js'));
	write(path.join(dir, 'deck', 'samples', 'out', 'slides', '001.png'));
	const files = engineFiles(dir);
	assert.deepEqual(files, ['cli/prs.mjs', 'theme/studio.css']);
	const before = filesHash(dir, files);
	write(path.join(dir, 'theme', 'studio.css'), 'c');
	assert.notEqual(filesHash(dir, files), before);
	assert.match(before, /^[0-9a-f]{12}$/);
});

test('a copy is ready only with its own hash; partial copies of dead runs are found', () => {
	const root = tmp();
	const dir = path.join(root, 'abc');
	assert.equal(copyState(dir, 'abc'), 'missing');
	fs.mkdirSync(dir);
	assert.equal(copyState(dir, 'abc'), 'incomplete');
	write(path.join(dir, '.setup-ready'), 'abc\n');
	assert.equal(copyState(dir, 'abc'), 'ready');
	fs.mkdirSync(`${dir}.partial-1`);
	fs.mkdirSync(`${dir}.partial-2`);
	assert.deepEqual(stalePartials(dir, pid => pid === 2).map(p => path.basename(p)), ['abc.partial-1']);
	assert.equal(stateDir({ PRS_HOME: root }), root);
});

test('work made inside older engine copies moves out once idle; the fullest, newest version keeps the plain name; nothing is lost', () => {
	const state = tmp();
	const engine = path.join(state, 'engine');
	const ageTree = (dir, ms) => {
		for (const entry of fs.readdirSync(dir, { recursive: true })) {
			age(path.join(dir, entry), ms);
		}
		age(dir, ms);
	};
	// a: a fetched PR in one copy (newer) and a video made from it in another (older): the video keeps the name.
	write(path.join(engine, 'old1', 'videos', 'a', 'brief.md'), 'fetched');
	write(path.join(engine, 'old2', 'videos', 'a', 'storyboard.json'), 'made');
	// d: a video in two copies: the newer keeps the name.
	write(path.join(engine, 'old1', 'videos', 'd', 'storyboard.json'), 'older');
	write(path.join(engine, 'old2', 'videos', 'd', 'storyboard.json'), 'newer');
	write(path.join(engine, 'old2', 'decks', 'b', 'deck.mjs'));
	ageTree(path.join(engine, 'old1', 'videos'), 2 * DAY);
	ageTree(path.join(engine, 'old2', 'videos', 'a'), 3 * DAY);
	ageTree(path.join(engine, 'old2', 'videos', 'd'), DAY);
	ageTree(path.join(engine, 'old2', 'decks'), 2 * DAY);
	write(path.join(engine, 'old2', 'videos', '.DS_Store'));
	// c: changed a moment ago (a session of that engine may still be making it), and work/ has c and c~old3 already.
	write(path.join(engine, 'old3', 'videos', 'c', 'scenes.js'), 'new');
	write(path.join(state, 'work', 'videos', 'c', 'scenes.js'), 'kept');
	write(path.join(state, 'work', 'videos', 'c~old3', 'scenes.js'), 'kept too');
	fs.mkdirSync(path.join(engine, 'new'), { recursive: true });
	fs.symlinkSync(path.join(state, 'work', 'videos'), path.join(engine, 'new', 'videos'), 'dir');
	for (const name of ['old1', 'old2', 'old3']) {
		write(path.join(engine, name, '.setup-ready'), `${name}\n`);
		age(path.join(engine, name, '.setup-ready'), 2 * DAY);
	}
	const relative = list => list.map(p => path.relative(state, p)).sort();
	const copies = () => oldCopies(engine, path.join(engine, 'new')).map(p => path.basename(p)).sort();
	assert.deepEqual(relative(migrateWork(state)), ['work/decks/b', 'work/videos/a', 'work/videos/a~old1', 'work/videos/d', 'work/videos/d~old1']);
	// old3 still holds c, so it stays.
	assert.deepEqual(copies(), ['old1', 'old2']);
	assert.deepEqual(relative(migrateWork(state, Date.now() + 2 * 60 * 60 * 1000)), ['work/videos/c~old3-2']);
	const read = (slug, file) => fs.readFileSync(path.join(state, 'work', 'videos', slug, file), 'utf8');
	assert.deepEqual(
		[read('a', 'storyboard.json'), read('a~old1', 'brief.md'), read('d', 'storyboard.json'), read('d~old1', 'storyboard.json'), read('c', 'scenes.js'), read('c~old3', 'scenes.js'), read('c~old3-2', 'scenes.js')],
		['made', 'fetched', 'newer', 'older', 'kept', 'kept too', 'new'],
	);
	assert.deepEqual(copies(), ['old1', 'old2', 'old3']);
});

test('a link is replaced in one step and left alone when it is right', () => {
	const dir = tmp();
	for (const name of ['one', 'two']) {
		fs.mkdirSync(path.join(dir, name));
	}
	const at = path.join(dir, 'node_modules');
	link(path.join(dir, 'one'), at);
	link(path.join(dir, 'two'), at);
	link(path.join(dir, 'two'), at);
	assert.equal(fs.readlinkSync(at), path.join(dir, 'two'));
	assert.deepEqual(fs.readdirSync(dir).sort(), ['node_modules', 'one', 'two']);
});

test('render caches go once their work is a week old; the sources stay', () => {
	const state = tmp();
	const fresh = path.join(state, 'work', 'videos', 'fresh');
	const old = path.join(state, 'work', 'videos', 'old');
	for (const dir of [fresh, old]) {
		write(path.join(dir, 'scenes.js'));
		write(path.join(dir, 'build', 'cache', 'f.png'));
		write(path.join(dir, 'build', 'frames', '00001.png'));
	}
	for (const p of [path.join(old, 'scenes.js'), path.join(old, 'build', 'cache'), path.join(old, 'build', 'frames'), path.join(old, 'build'), old]) {
		age(p, 8 * DAY);
	}
	assert.deepEqual(staleCaches(state).map(p => path.relative(state, p)).sort(), ['work/videos/old/build/cache', 'work/videos/old/build/frames']);
});

test('old engine copies and unused packages go; the current copy, recent ones and linked packages stay', () => {
	const state = tmp();
	const engine = path.join(state, 'engine');
	for (const [name, days] of [['current', 3], ['recent', 0], ['old', 2]]) {
		write(path.join(engine, name, '.setup-ready'), `${name}\n`);
		age(path.join(engine, name, '.setup-ready'), days * DAY);
	}
	assert.deepEqual(oldCopies(engine, path.join(engine, 'current')).map(p => path.basename(p)), ['old']);
	for (const [name, days] of [['linked', 3], ['unused', 3], ['fresh', 0]]) {
		write(path.join(state, 'deps', name, '.setup-ready'), `${name}\n`);
		fs.mkdirSync(path.join(state, 'deps', name, 'node_modules'));
		age(path.join(state, 'deps', name, '.setup-ready'), days * DAY);
	}
	fs.symlinkSync(path.join(state, 'deps', 'linked', 'node_modules'), path.join(engine, 'current', 'node_modules'), 'dir');
	assert.deepEqual(unusedDeps(state).map(p => path.basename(p)), ['unused']);
});

test('app builds unused for two weeks go, and partial downloads after a day; recent ones stay', () => {
	const root = tmp();
	for (const [name, days, ready] of [['used', 3, true], ['old', 15, true], ['partial', 2, false], ['downloading', 0, false]]) {
		const dir = path.join(root, name);
		fs.mkdirSync(dir);
		if (ready) {
			write(path.join(dir, '.ready'), 'sha\n');
			age(path.join(dir, '.ready'), days * DAY);
		} else {
			age(dir, days * DAY);
		}
	}
	assert.deepEqual(staleBuilds(root).map(p => path.basename(p)).sort(), ['old', 'partial']);
});
