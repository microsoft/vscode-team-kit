// Copyright (c) Microsoft Corporation. Licensed under the MIT license.

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { categories } from './model.mjs';

export function validateFilter(input) {
	if (!input || typeof input !== 'object' || Array.isArray(input)
		|| Object.keys(input).some(key => !['query', 'categories'].includes(key))
		|| (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 2000))
		|| (input.categories !== undefined && (!Array.isArray(input.categories)
			|| input.categories.length > categories.length || input.categories.some(category => !categories.includes(category))))) {
		throw new Error('Expected query (up to 2000 characters) and/or an array of timeline categories.');
	}
	return input;
}

export async function createTimelineServer(source) {
	const token = randomBytes(32).toString('hex');
	const cookieName = `timeline-${randomBytes(8).toString('hex')}`;
	const assets = new Map(await Promise.all([
		['/', 'index.html', 'text/html; charset=utf-8'],
		['/timeline.css', 'timeline.css', 'text/css; charset=utf-8'],
		['/timeline.mjs', 'timeline.mjs', 'text/javascript; charset=utf-8'],
		['/find-worker.mjs', 'find-worker.mjs', 'text/javascript; charset=utf-8'],
		['/model.mjs', '../model.mjs', 'text/javascript; charset=utf-8'],
	].map(async ([path, file, type]) => [path, { body: await readFile(new URL(`./public/${file}`, import.meta.url)), type }])));
	const view = { query: '', categories: [...categories], expanded: [], follow: false, announcements: true };
	let viewRevision = 0;
	let origin;
	const server = createServer((request, response) => {
		void handle(request, response).catch(error => {
			source.fail(error);
			if (!response.headersSent) {
				response.writeHead(500, { 'Content-Type': 'application/json' });
			}
			response.end(JSON.stringify({ error: 'The timeline request failed. See the timeline status for details.' }));
		});
	});
	function send(response, status, body, type = 'application/json; charset=utf-8') {
		response.writeHead(status, { 'Content-Type': type });
		response.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
	}
	async function handle(request, response) {
		response.setHeader('Cache-Control', 'no-store');
		response.setHeader('X-Content-Type-Options', 'nosniff');
		response.setHeader('Referrer-Policy', 'no-referrer');
		response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
		if (request.headers.host !== new URL(origin).host) {
			return send(response, 403, { error: 'Invalid host.' });
		}
		const url = new URL(request.url, origin);
		const asset = assets.get(url.pathname);
		if (request.method === 'GET' && asset) {
			if (url.pathname === '/') {
				response.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`);
			}
			return send(response, 200, asset.body, asset.type);
		}
		const authorized = request.headers.cookie?.split(';').some(cookie => cookie.trim() === `${cookieName}=${token}`);
		if (!authorized || (request.headers.origin && request.headers.origin !== origin)) {
			return send(response, 403, { error: 'Open the canvas before accessing its data.' });
		}
		if (request.method === 'GET' && url.pathname === '/api/state') {
			const revision = `${source.revision}:${viewRevision}`;
			if (url.searchParams.get('revision') === revision) {
				response.writeHead(204);
				return response.end();
			}
			return send(response, 200, { ...source.snapshot(), revision, view });
		}
		if (request.method === 'GET' && url.pathname === '/api/raw') {
			response.setHeader('Content-Disposition', 'attachment; filename="session-events.jsonl"');
			return send(response, 200, source.raw(), 'application/x-ndjson; charset=utf-8');
		}
		if (request.method === 'POST' && ['/api/view', '/api/refresh'].includes(url.pathname)) {
			if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json') {
				return send(response, 403, { error: 'Expected a same-origin JSON request.' });
			}
			let body = '';
			for await (const chunk of request) {
				body += chunk;
				if (Buffer.byteLength(body) > 65536) {
					return send(response, 413, { error: 'Request is too large.' });
				}
			}
			let input;
			try {
				input = JSON.parse(body);
				if (url.pathname === '/api/view') {
					if (!input || typeof input !== 'object' || Array.isArray(input)) {
						throw new Error('Expected a view object.');
					}
					validateFilter({ query: input.query, categories: input.categories });
					if (Object.keys(input).some(key => !Object.hasOwn(view, key))
						|| (input.expanded !== undefined && (!Array.isArray(input.expanded) || input.expanded.length > 10000 || input.expanded.some(id => typeof id !== 'string' || id.length > 200)))
						|| ['follow', 'announcements'].some(key => input[key] !== undefined && typeof input[key] !== 'boolean')) {
						throw new Error('Invalid timeline view state.');
					}
					Object.assign(view, input);
					viewRevision++;
				} else {
					if (!input || Object.keys(input).length) {
						throw new Error('Refresh takes an empty object.');
					}
				}
			} catch (error) {
				return send(response, 400, { error: error.message });
			}
			if (url.pathname === '/api/refresh') {
				await source.refresh();
			}
			return send(response, 200, { ok: true });
		}
		return send(response, 404, { error: 'Not found.' });
	}
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	origin = `http://127.0.0.1:${server.address().port}`;
	return {
		url: origin,
		setFilter(input) {
			Object.assign(view, validateFilter(input));
			viewRevision++;
			return { query: view.query, categories: [...view.categories] };
		},
		close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
	};
}
