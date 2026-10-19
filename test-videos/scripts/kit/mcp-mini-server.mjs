#!/usr/bin/env node
// A tiny MCP server over stdio, for how-to videos: nothing to install (no npx), runs from the throwaway folder.
//
//   node mcp-mini-server.mjs [name]
//
// Tools: `ping` (replies "pong from <name>") and `get_env` ({ name }: the value of that environment variable in the
// server's process, or "(not set)"). On start it writes "mcp-mini-server <name> started pid=<pid>" to stderr, and it
// appends one line per request to $MCP_MINI_LOG if that variable is set, so a scenario can check the server ran.
import fs from 'node:fs';
import readline from 'node:readline';

const NAME = process.argv[2] || 'mini';
const LOG = process.env.MCP_MINI_LOG;
const log = line => {
	if (LOG) {
		try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${NAME} pid=${process.pid} ${line}\n`); } catch { }
	}
};
process.stderr.write(`mcp-mini-server ${NAME} started pid=${process.pid}\n`);
log('started');

const TOOLS = [
	{ name: 'ping', description: `Replies "pong from ${NAME}".`, inputSchema: { type: 'object', properties: {} } },
	{
		name: 'get_env',
		description: 'Returns the value of an environment variable in this server\'s process.',
		inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'The variable name' } }, required: ['name'] },
	},
];

const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');

function handle(request) {
	const { id, method, params } = request;
	log(method);
	if (id === undefined) {
		return; // a notification, e.g. notifications/initialized
	}
	switch (method) {
		case 'initialize':
			return send({ id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: NAME, version: '1.0.0' } } });
		case 'ping':
			return send({ id, result: {} });
		case 'tools/list':
			return send({ id, result: { tools: TOOLS } });
		case 'tools/call': {
			const tool = params?.name;
			if (tool === 'ping') {
				return send({ id, result: { content: [{ type: 'text', text: `pong from ${NAME}` }] } });
			}
			if (tool === 'get_env') {
				const key = String(params?.arguments?.name ?? '');
				const value = Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : '(not set)';
				return send({ id, result: { content: [{ type: 'text', text: `${key}=${value}` }] } });
			}
			return send({ id, error: { code: -32602, message: `Unknown tool: ${tool}` } });
		}
		case 'resources/list':
			return send({ id, result: { resources: [] } });
		case 'prompts/list':
			return send({ id, result: { prompts: [] } });
		default:
			return send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
	}
}

readline.createInterface({ input: process.stdin }).on('line', line => {
	if (!line.trim()) {
		return;
	}
	try {
		handle(JSON.parse(line));
	} catch (error) {
		send({ id: null, error: { code: -32700, message: `Parse error: ${error.message}` } });
	}
});
