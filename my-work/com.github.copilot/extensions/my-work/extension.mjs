import { CanvasError, createCanvas, joinSession } from '@github/copilot-sdk/extension';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Developer mode: "devSource" in my-work.config.json points at a my-work checkout, and the panel runs
// from there (its own lib and assets), so changes can be tried without publishing the plugin. Asset
// edits reload the open panel; lib edits need an extensions reload.
function libBase() {
	const home = process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
	try {
		const { devSource } = JSON.parse(readFileSync(path.join(home, 'project-boards', 'my-work.config.json'), 'utf8'));
		if (typeof devSource === 'string' && devSource) {
			const dir = path.join(devSource.replace(/^~(?=$|\/)/, os.homedir()), 'com.github.copilot', 'extensions', 'my-work');
			if (existsSync(path.join(dir, 'lib', 'runtime.mjs'))) return pathToFileURL(dir + path.sep).href;
		}
	} catch { /* no config or no devSource */ }
	return new URL('./', import.meta.url).href;
}
const base = libBase();
const { actionDefinitions, TriageRuntime } = await import(new URL('lib/runtime.mjs', base).href);
const { CANVAS_ID } = await import(new URL('lib/data.mjs', base).href);
const devMode = base !== new URL('./', import.meta.url).href;

let session;
const log = (message, level = 'info') => {
	void session?.log(message, { level }).catch(() => { });
};

const sendToChat = async prompt => {
	if (!session) {
		throw Object.assign(new Error('Not connected to a chat yet'), { code: 'not_connected' });
	}
	return session.send({ prompt });
};

const runtime = new TriageRuntime({ log, sendToChat });

async function guarded(operation) {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof CanvasError) {
			throw error;
		}
		const code = typeof error?.code === 'string' && /^[a-z_]+$/.test(error.code) ? error.code : 'triage_failed';
		if (code === 'triage_failed') {
			log(`My issues triage failed: ${error?.message ?? error}`, 'error');
		}
		throw new CanvasError(code, String(error?.message ?? error));
	}
}

session = await joinSession({
	canvases: [
		createCanvas({
			id: CANVAS_ID,
			displayName: devMode ? 'My Work (dev)' : 'My Work',
			description: 'My Work board: planned work and priorities, MSRC items, GitHub notifications, the issue queue and Sweeper-backed cleanup, with work sessions per item.',
			actions: actionDefinitions.map(action => ({
				...action,
				handler: context => guarded(() => runtime.invoke(context.instanceId, action.name, context.input ?? {})),
			})),
			open: context => guarded(() => runtime.open(context.instanceId)),
			onClose: context => guarded(() => runtime.close(context.instanceId)),
		}),
	],
});

process.once('SIGTERM', () => {
	void runtime.dispose().finally(() => process.exit(0));
});
