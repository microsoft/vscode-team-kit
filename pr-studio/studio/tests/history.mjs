// The ledger of published videos, and how cloud sessions' videos get back into it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectHistory, mergeHistory, readHistory } from '../cli/lib/history.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const entry = (slug, date) => ({ slug, date, treatments: {} });
const lines = entries => entries.map(e => JSON.stringify(e)).join('\n') + '\n';

test('one entry per video, the newest wins, oldest first', () => {
	const merged = mergeHistory([entry('a', '2026-10-01'), entry('b', '2026-10-03')], [entry('a', '2026-10-04'), entry('c', '2026-10-02')]);
	assert.deepStrictEqual(merged.map(e => `${e.slug}@${e.date}`), ['c@2026-10-02', 'b@2026-10-03', 'a@2026-10-04']);
});

test('collect merges the history committed on every copilot/* session branch', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prs-history-'));
	try {
		const remote = path.join(root, 'remote.git');
		git(root, 'init', '-q', '--bare', remote);
		// Two cloud sessions, each on its own branch with the videos it made; one more branch without a history file.
		const session = path.join(root, 'session');
		git(root, 'init', '-q', session);
		git(session, 'config', 'user.email', 'test@example.com');
		git(session, 'config', 'user.name', 'test');
		fs.mkdirSync(path.join(session, 'gallery'));
		const commit = (branch, entries) => {
			git(session, 'checkout', '-q', '--orphan', branch);
			git(session, 'rm', '-rq', '--cached', '--ignore-unmatch', '.');
			if (entries) {
				fs.writeFileSync(path.join(session, 'gallery', 'history.jsonl'), lines(entries));
				git(session, 'add', 'gallery/history.jsonl');
			}
			git(session, 'commit', '-q', '--allow-empty', '-m', branch);
			git(session, 'push', '-q', remote, `${branch}:${branch}`);
		};
		commit('copilot/monday', [entry('x', '2026-10-01'), entry('old', '2026-09-01')]);
		commit('copilot/tuesday', [entry('y', '2026-10-02'), entry('old', '2026-09-01')]);
		commit('copilot/docs-only', null);
		commit('feature/not-a-session', [entry('z', '2026-10-03')]);

		const main = path.join(root, 'main');
		git(root, 'init', '-q', main);
		git(main, 'remote', 'add', 'origin', remote);
		fs.mkdirSync(path.join(main, 'gallery'));
		fs.writeFileSync(path.join(main, 'gallery', 'history.jsonl'), lines([entry('old', '2026-09-01')]));

		const first = collectHistory({ cwd: main });
		const again = collectHistory({ cwd: main });
		assert.deepStrictEqual({ first, again, slugs: readHistory(path.join(main, 'gallery', 'history.jsonl')).map(e => e.slug) }, {
			first: { branches: 3, added: 2, total: 3 },
			again: { branches: 3, added: 0, total: 3 },
			slugs: ['old', 'x', 'y'],
		});
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
