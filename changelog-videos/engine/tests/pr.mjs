// A PR of the changelog: the settings its diff adds or whose default it changes (what a chapter's toggle may show).
import test from 'node:test';
import assert from 'node:assert/strict';
import { closingRefs, parseDiff, settingsFromDiff, testsFromDiff } from '../cli/lib/pr.mjs';

const DIFF = [
	'diff --git a/src/vs/workbench/contrib/chat/browser/chat.contribution.ts b/src/vs/workbench/contrib/chat/browser/chat.contribution.ts',
	'--- a/src/vs/workbench/contrib/chat/browser/chat.contribution.ts',
	'+++ b/src/vs/workbench/contrib/chat/browser/chat.contribution.ts',
	'@@ -600,7 +600,7 @@ configurationRegistry.registerConfiguration({',
	' \t\t[ChatConfiguration.EditorWorkingSetEnabled]: {',
	' \t\t\ttype: \'boolean\',',
	' \t\t\tdescription: nls.localize(\'chat.editor.workingSet.enabled\', "Show the working set."),',
	'-\t\t\tdefault: false,',
	'+\t\t\tdefault: true,',
	' \t\t\ttags: [\'experimental\'],',
	' \t\t},',
	'@@ -700,3 +700,9 @@ configurationRegistry.registerConfiguration({',
	'+\t\t\'chat.welcomePage.signIn.enabled\': {',
	'+\t\t\ttype: \'boolean\',',
	'+\t\t\tdefault: true,',
	'+\t\t},',
	'+\t\t\'chat.untouched.setting\': {',
	'+\t\t\ttype: \'string\',',
	'+\t\t},',
	'diff --git a/src/vs/workbench/contrib/chat/test/browser/chat.test.ts b/src/vs/workbench/contrib/chat/test/browser/chat.test.ts',
	'--- a/src/vs/workbench/contrib/chat/test/browser/chat.test.ts',
	'+++ b/src/vs/workbench/contrib/chat/test/browser/chat.test.ts',
	'@@ -1,1 +1,4 @@',
	'+\ttest(\'pasting files inserts their paths\', () => {',
	'+\t\tconst setting = { \'chat.test.only\': {',
	'+\t\t\tdefault: false,',
	'+\t\t} };',
].join('\n');

test('a PR\'s settings: a default it changes (with the old one), a setting it adds; tests and settings without a default aside', () => {
	const files = parseDiff(DIFF);
	assert.deepStrictEqual({
		settings: settingsFromDiff(files).map(s => [s.id ?? s.constant, s.was, s.default, s.added]),
		tests: testsFromDiff(files),
		fixes: closingRefs('Fixes #12 and closes microsoft/vscode#34; see #56', 'microsoft/vscode').map(i => i.number),
	}, {
		settings: [
			['ChatConfiguration.EditorWorkingSetEnabled', 'false', 'true', false],
			['chat.welcomePage.signIn.enabled', null, 'true', true],
		],
		tests: [{ path: 'src/vs/workbench/contrib/chat/test/browser/chat.test.ts', names: ['pasting files inserts their paths'] }],
		fixes: [12, 34],
	});
});
