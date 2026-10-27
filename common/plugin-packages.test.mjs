// Copyright (c) Microsoft Corporation. Licensed under the MIT license.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';

const root = new URL('../', import.meta.url);
const schemaId = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const readJson = async path => JSON.parse(await readFile(new URL(path, root), 'utf8'));
const schema = await readJson('common/schemas/agent-plugins-1.0.0/plugin.schema.json');
const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile(schema);
const marketplace = await readJson('marketplace.json');
const localEntries = marketplace.plugins.filter(entry => typeof entry.source === 'string' && entry.source.startsWith('./'));

test('all 14 local packages are registered once without legacy manifests', async () => {
	const packages = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
		const prefix = `${entry.name}/`;
		for (const path of ['.plugin/plugin.json', '.claude-plugin/plugin.json']) {
			assert.equal(existsSync(new URL(prefix + path, root)), false, `${prefix}${path} must not exist`);
		}
		if (existsSync(new URL(prefix + 'plugin.json', root))) packages.push(entry.name);
	}
	assert.equal(packages.length, 14);
	assert.equal(localEntries.length, packages.length);
	assert.equal(new Set(marketplace.plugins.map(entry => entry.name)).size, marketplace.plugins.length);
	assert.deepEqual(packages.sort(), localEntries.map(entry => entry.name).sort());
});

for (const entry of localEntries) {
	test(`${entry.name}: canonical schema, marketplace metadata, and changelog agree`, async () => {
		assert.equal(entry.source, `./${entry.name}/`);
		const manifest = await readJson(`${entry.name}/plugin.json`);
		assert.equal(validate(manifest), true, ajv.errorsText(validate.errors));
		assert.equal(manifest.$schema, schemaId);
		for (const field of ['name', 'version', 'description', 'keywords']) {
			assert.deepEqual(manifest[field], entry[field], `${entry.name}: ${field} differs from marketplace`);
		}
		assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
		const changelog = await readFile(new URL(`${entry.name}/CHANGELOG.md`, root), 'utf8');
		assert.equal(changelog.match(/^## (\d+\.\d+\.\d+)/m)?.[1], manifest.version);
		assert.match(changelog, /BREAKING: Require Agent Plugins 1\.0/);
		for (const field of ['categories', 'status', 'maintainers', 'evals']) {
			assert.equal(field in manifest, false, `${field} belongs only in marketplace.json`);
		}
		for (const kind of ['agents', 'commands', 'extensions']) {
			assert.equal(existsSync(new URL(`${entry.name}/${kind}/`, root)), false, `${kind} must be namespaced`);
		}
		assert.equal(existsSync(new URL(`${entry.name}/hooks/hooks.json`, root)), false, 'hook configuration must be namespaced');
	});
}

test('canonical schema rejects legacy fields and component path strings', () => {
	for (const extra of [{ categories: [] }, { hooks: './hooks' }, { extensions: 'extensions/' }]) {
		assert.equal(validate({ $schema: schemaId, name: 'invalid', ...extra }), false);
	}
	assert.equal(validate({ name: 'missing-schema' }), false);
	assert.equal(validate({ $schema: schemaId, name: 'valid', extensions: { 'com.github.copilot': {} } }), true);
});

test('Copilot components occupy their runtime discovery locations', async () => {
	const components = {
		debug: ['agents/debug.agent.md'],
		'github-inbox': [
			'agents/inbox.agent.md', 'agents/inbox-investigator.agent.md', 'agents/inbox-memory.agent.md',
			'agents/inbox-project-board.agent.md', 'agents/inbox-reviewer.agent.md',
			'agents/inbox-summarizer.agent.md', 'agents/inbox-triager.agent.md',
		],
		'handy-commands': ['commands/commit-and-pr.md', 'commands/fix-issue.md', 'commands/pr-comments.md'],
		'ban-ast': ['hooks/hooks.json'],
		'review-plan': ['hooks/hooks.json'],
		'session-timeline': ['extensions/session-timeline/extension.mjs', 'extensions/session-timeline/public/index.html'],
		'my-work': ['extensions/my-work/extension.mjs', 'extensions/my-work/assets/index.html'],
	};
	for (const [name, paths] of Object.entries(components)) {
		for (const path of paths) {
			assert.equal(existsSync(new URL(`${name}/com.github.copilot/${path}`, root)), true, `${name}: missing ${path}`);
		}
	}
	assert.equal(existsSync(new URL('review-plan/hooks/remind-plan-review.mts', root)), true);
	assert.equal(existsSync(new URL('ban-ast/scripts/check-bans.mts', root)), true);
});

test('external dap-cli remains an upstream-owned marketplace entry', () => {
	const entry = marketplace.plugins.find(plugin => plugin.name === 'dap-cli');
	assert.deepEqual(entry.source, { source: 'github', repo: 'roblourens/dap-cli' });
	assert.equal(existsSync(new URL('dap-cli/', root)), false);
});
