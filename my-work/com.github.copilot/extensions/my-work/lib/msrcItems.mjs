// MSRC items the user pastes into My Work (IcM link + description). Stored in the user's private
// My Work data folder (config.dataDir), never in a repository or on GitHub.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir } from './config.mjs';

const FILE = path.join(dataDir(), 'msrc-items.json');
const FORMAT = 'my-work/msrc-items';
const VERSION = 1;

export const INCIDENT_RE = /^\d{5,20}$/;

async function read() {
	let data;
	try { data = JSON.parse(await fs.readFile(FILE, 'utf8')); } catch (error) {
		if (error.code === 'ENOENT') return [];
		throw Object.assign(new Error(`Cannot read ${FILE}: ${error.message}`), { code: 'storage' });
	}
	if (data?.format !== FORMAT || data.version !== VERSION || !Array.isArray(data.items)) {
		throw Object.assign(new Error(`Unrecognized or corrupt data in ${FILE}; not overwriting it.`), { code: 'storage' });
	}
	return data.items;
}

async function write(items) {
	await fs.mkdir(path.dirname(FILE), { recursive: true, mode: 0o700 });
	const tmp = path.join(path.dirname(FILE), `.tmp-${process.pid}-${randomUUID()}.json`);
	await fs.writeFile(tmp, JSON.stringify({ format: FORMAT, version: VERSION, items }, null, 2), { mode: 0o600 });
	await fs.rename(tmp, FILE);
}

export async function listMsrcItems() {
	return (await read()).filter(i => !i.done);
}

/** Pull the incident id out of an IcM link (…/incidents/details/<id>/…) or a bare number. */
export function parseIncident(text) {
	const t = String(text || '').trim();
	const m = t.match(/incidents?\/(?:details\/)?(\d{5,20})/i) || t.match(/^(?:icm\s*)?(\d{5,20})$/i);
	return m ? m[1] : null;
}

export async function saveMsrcItem({ incidentId, link, title, description, resolveBy }) {
	const items = await read();
	const now = new Date().toISOString();
	const at = items.findIndex(i => i.incidentId === incidentId);
	const item = {
		...(at >= 0 ? items[at] : { incidentId, addedAt: now }),
		link: link || `https://portal.microsofticm.com/imp/v5/incidents/details/${incidentId}/summary`,
		title, description, resolveBy: resolveBy || '', done: false, updatedAt: now,
	};
	if (at >= 0) items[at] = item; else items.push(item);
	await write(items);
	return item;
}

export async function removeMsrcItem(incidentId) {
	const items = await read();
	const kept = items.filter(i => i.incidentId !== incidentId);
	if (kept.length !== items.length) await write(kept);
	return { removed: kept.length !== items.length };
}

export async function getMsrcItem(incidentId) {
	return (await read()).find(i => i.incidentId === incidentId) || null;
}
