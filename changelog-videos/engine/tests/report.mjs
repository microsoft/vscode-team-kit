// The VS Code changelog report: its picks, and the report out of its run's artifact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadReport, parseReport, reportTokens, topPicks } from '../cli/lib/report.mjs';
import { unzip } from '../cli/lib/github.mjs';

// A made-up report in the format of the Changelog PR Report: the top picks, a ":::THREAD:::" line, the rest.
const REPORT = [
	'### Contoso Editor Changelog — 2026-01-15 — [Learn more](https://example.com/changelog-report.md)',
	'',
	'The most important user-facing changes merged in the last ~24h. ⚠️ flags changes worth a closer look before they reach users. More highlights in the thread 🧵.',
	'',
	'1. ⚠️ [#101 settings: turn the new file picker on by default](https://github.com/contoso/editor/pull/101) — The new file picker is now on by default in every build, so everyone gets it unless they turned it off. — _@octocat_',
	'2. ⚠️ [#102 Show sandbox rules in the status bar](https://github.com/contoso/editor/pull/102) — The status bar now shows which sandbox rules apply to the session, and `/sandbox rules` opens the full list. — _@hubot_',
	'4. ✨ [#104 chat: pick a model before the session starts](https://github.com/contoso/editor/pull/104) — The chat view now lets users choose a model and an approval level before the session starts. — _@monalisa_',
	':::THREAD:::',
	'**More highlights** from the same ~24h window:',
	'',
	'10. ✨ [#110 Keep build output visible while it streams](https://github.com/contoso/editor/pull/110) — Live build output now stays visible while a task runs instead of disappearing on each update. — _@mona_',
	'',
].join('\n');

test('the picks of a changelog report, in order, the thread apart, and the top ones the video shows', () => {
	const report = parseReport(REPORT);
	assert.deepStrictEqual({
		title: report.title,
		date: report.date,
		picks: report.picks.map(p => [p.rank, p.section, p.flag, p.warning, `${p.repo}#${p.number}`, p.title, p.author]),
		summary: report.picks[1].summary,
		top: topPicks(report).map(p => p.number),
	}, {
		title: 'Contoso Editor Changelog — 2026-01-15',
		date: '2026-01-15',
		picks: [
			[1, 'main', '⚠️', true, 'contoso/editor#101', 'settings: turn the new file picker on by default', 'octocat'],
			[2, 'main', '⚠️', true, 'contoso/editor#102', 'Show sandbox rules in the status bar', 'hubot'],
			[4, 'main', '✨', false, 'contoso/editor#104', 'chat: pick a model before the session starts', 'monalisa'],
			[10, 'thread', '✨', false, 'contoso/editor#110', 'Keep build output visible while it streams', 'mona'],
		],
		summary: 'The status bar now shows which sandbox rules apply to the session, and `/sandbox rules` opens the full list.',
		top: [101, 102, 104],
	});
});

test('the report comes out of the run artifact (a zip with deflated and stored entries)', () => {
	// Made with Python's zipfile: report.md deflated, notes.txt stored.
	const zip = Buffer.from('UEsDBBQAAAAIAGSARV0UpNnyGwAAAFgAAAAJAAAAcmVwb3J0Lm1kU1ZWVggLVnDOT0lVcM5IzEtPzclP51KmWBQAUEsDBBQAAAAAAGSARV2sJLvgDAAAAAwAAAAJAAAAbm90ZXMudHh0c3RvcmVkIGFzIGlzUEsBAhQDFAAAAAgAZIBFXRSk2fIbAAAAWAAAAAkAAAAAAAAAAAAAAIABAAAAAHJlcG9ydC5tZFBLAQIUAxQAAAAAAGSARV2sJLvgDAAAAAwAAAAJAAAAAAAAAAAAAACAAUIAAABub3Rlcy50eHRQSwUGAAAAAAIAAgBuAAAAdQAAAAAA', 'base64');
	assert.deepStrictEqual(Object.fromEntries(Object.entries(unzip(zip)).map(([name, data]) => [name, data.toString('utf8')])), {
		'report.md': '### VS Code Changelog\n'.repeat(4),
		'notes.txt': 'stored as is',
	});
});

test('the report is read with the first account that can read it: CHANGELOG_TOKEN alone when set', async () => {
	const tried = [];
	const read = async ({ token }) => {
		tried.push(token);
		if (token !== 'personal') {
			throw new Error('GitHub 404 for repos/microsoft/vscode-engineering/actions/runs/1/artifacts: Not Found');
		}
		return { text: 'report', run: 1 };
	};
	const report = await downloadReport({ run: 1, tokens: ['work', 'personal', 'other'], read });
	await assert.rejects(downloadReport({ run: 1, tokens: ['work'], read }), /Cannot read the changelog report .* with this token/);
	await assert.rejects(downloadReport({ run: 1, tokens: ['personal'], read: async () => { throw new Error('GitHub 500 for x: down'); } }), /GitHub 500/);
	assert.deepStrictEqual([report.text, tried, reportTokens({ CHANGELOG_TOKEN: 'set' })], ['report', ['work', 'personal', 'work'], ['set']]);
});
