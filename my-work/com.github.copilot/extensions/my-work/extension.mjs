import { CanvasError, createCanvas, joinSession } from '@github/copilot-sdk/extension';
import { actionDefinitions, TriageRuntime } from './lib/runtime.mjs';
import { CANVAS_ID } from './lib/data.mjs';

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
			displayName: 'My Work',
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
