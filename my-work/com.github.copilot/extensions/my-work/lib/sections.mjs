// Custom sections in My Work, defined by the user: a name, optional private instructions for sessions
// started from the section, and an optional link pattern so pasting a matching link adds a note there.
// Sections hold notes (title, link, description, due date) plus issues and sessions placed in them.
// Stored privately in the My Work data folder (config.dataDir), never in a repository or on GitHub.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, dataDir } from './config.mjs';

const FORMAT = 'my-work/sections';
const VERSION = 1;
const file = () => path.join(dataDir(), 'sections.json');
const RESERVED = new Set(['current', 'next', 'priorities', 'recent']);
export const SECTION_ID_RE = /^[a-z][a-z0-9-]{0,30}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fail(message, status = 400) {
	return Object.assign(new Error(message), { status, code: 'bad_input' });
}

async function read() {
	let data;
	try { data = JSON.parse(await fs.readFile(file(), 'utf8')); } catch (error) {
		if (error.code === 'ENOENT') return migrate();
		throw Object.assign(new Error(`Cannot read ${file()}: ${error.message}`), { code: 'storage' });
	}
	if (data?.format !== FORMAT || data.version !== VERSION || !Array.isArray(data.sections) || !Array.isArray(data.notes)) {
		throw Object.assign(new Error(`Unrecognized or corrupt data in ${file()}; not overwriting it.`), { code: 'storage' });
	}
	return data;
}
async function write(data) {
	await fs.mkdir(path.dirname(file()), { recursive: true, mode: 0o700 });
	const tmp = path.join(path.dirname(file()), `.tmp-${process.pid}-${randomUUID()}.json`);
	await fs.writeFile(tmp, JSON.stringify({ format: FORMAT, version: VERSION, sections: data.sections, notes: data.notes }, null, 2), { mode: 0o600 });
	await fs.rename(tmp, file());
}

// Earlier versions had a built-in MSRC section (msrc-items.json + msrc.fixWorkflow in the config).
// The first run turns it into a custom "MSRC" section with the same items and instructions.
const MSRC_PRIVACY = 'This is a security fix: work only in a private repository or private fork (ask me which one if it is not clear). Never use the public repository, a public branch, a public PR or a public issue, and do not paste any of these details anywhere public.';
async function migrate() {
	const data = { sections: [], notes: [] };
	let old = [];
	try {
		const d = JSON.parse(await fs.readFile(path.join(dataDir(), 'msrc-items.json'), 'utf8'));
		if (d?.format === 'my-work/msrc-items' && Array.isArray(d.items)) old = d.items.filter(i => !i.done);
	} catch { /* nothing to migrate */ }
	const workflow = String(config().msrc?.fixWorkflow || '').trim();
	if (old.length || workflow) {
		const now = new Date().toISOString();
		data.sections.push({ id: 'msrc', name: 'MSRC', instructions: `${workflow ? `${workflow}\n` : ''}${MSRC_PRIVACY}`, linkPattern: 'incidents?/(?:details/)?(\\d{5,20})', createdAt: now });
		for (const i of old) data.notes.push({
			id: randomUUID(), section: 'msrc', ref: String(i.incidentId), title: i.title || `IcM ${i.incidentId}`,
			link: i.link || '', description: i.description || '', due: i.resolveBy || '', addedAt: i.addedAt || now, updatedAt: now,
		});
	}
	await write(data);
	return data;
}

function compile(pattern) {
	if (!pattern) return null;
	try { return new RegExp(pattern, 'i'); } catch { return null; }
}

export async function listSections() {
	return (await read()).sections;
}
export async function getSection(id) {
	return (await listSections()).find(s => s.id === id) || null;
}
/** Whether `id` names a group items can be placed in: a built-in bucket or an existing custom section. */
export async function isGroup(id) {
	return ['current', 'next', 'priorities'].includes(id) || !!(await getSection(id));
}

function slug(name, taken) {
	let base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
	if (!/^[a-z]/.test(base)) base = `s-${base}`.replace(/-+$/, '') || 's';
	let id = base, n = 2;
	while (RESERVED.has(id) || taken.has(id)) id = `${base}-${n++}`;
	return id;
}

export async function saveSection({ id, name, instructions = '', linkPattern = '' }) {
	name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
	if (!name) throw fail('A section needs a name');
	instructions = String(instructions || '').trim().slice(0, 4000);
	linkPattern = String(linkPattern || '').trim().slice(0, 200);
	if (linkPattern && !compile(linkPattern)) throw fail('The link pattern is not a valid regular expression');
	const data = await read();
	let section = id ? data.sections.find(s => s.id === id) : null;
	if (id && !section) throw fail('That section does not exist', 404);
	if (!section) {
		section = { id: slug(name, new Set(data.sections.map(s => s.id))), createdAt: new Date().toISOString() };
		data.sections.push(section);
	}
	Object.assign(section, { name, instructions, linkPattern });
	await write(data);
	return section;
}

// The order of items in a section, as refs: note:<id>, issue:<owner/repo#N>, session:<id>. Items not listed go last.
const ORDER_REF_RE = /^(note:[\w-]{1,80}|issue:[\w.-]+\/[\w.-]+#\d+|session:[\w-]{8,80})$/;
export async function setSectionOrder(id, order) {
	if (!Array.isArray(order) || order.length > 500 || !order.every(r => typeof r === 'string' && ORDER_REF_RE.test(r))) throw fail('invalid order');
	const data = await read();
	const section = data.sections.find(s => s.id === id);
	if (!section) throw fail('That section does not exist', 404);
	section.order = [...new Set(order)];
	await write(data);
	return section;
}

export async function moveSection(id, dir) {
	const data = await read();
	const i = data.sections.findIndex(s => s.id === id);
	const j = i + (dir === 'up' ? -1 : 1);
	if (i < 0 || j < 0 || j >= data.sections.length) return data.sections;
	[data.sections[i], data.sections[j]] = [data.sections[j], data.sections[i]];
	await write(data);
	return data.sections;
}

/** Delete a section and its notes; the caller moves its issues and sessions back to Current. */
export async function removeSection(id) {
	const data = await read();
	const before = data.sections.length;
	data.sections = data.sections.filter(s => s.id !== id);
	const notes = data.notes.filter(n => n.section === id).length;
	data.notes = data.notes.filter(n => n.section !== id);
	if (data.sections.length !== before) await write(data);
	return { removed: data.sections.length !== before, notes };
}

export async function listNotes() {
	return (await read()).notes;
}
export async function getNote(id) {
	return (await listNotes()).find(n => n.id === id) || null;
}

/** The section (and reference) a pasted link belongs to, from the sections' link patterns. */
export async function sectionForLink(text) {
	const t = String(text || '').trim();
	if (!/^https?:\/\//i.test(t)) return null;
	for (const s of await listSections()) {
		const m = compile(s.linkPattern)?.exec(t);
		if (m) return { section: s.id, ref: m[1] || m[0], link: t };
	}
	return null;
}

export async function saveNote({ id, section, title, link = '', ref = '', description = '', due = '' }) {
	const data = await read();
	if (!data.sections.some(s => s.id === section)) throw fail('That section does not exist', 404);
	title = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 200);
	link = String(link || '').trim().slice(0, 1000);
	if (link && !/^https?:\/\//i.test(link)) throw fail('The link must start with http:// or https://');
	ref = String(ref || '').trim().slice(0, 80);
	description = String(description || '').slice(0, 20000);
	due = String(due || '');
	if (due && !DATE_RE.test(due)) throw fail('invalid date');
	if (!title && !ref) throw fail('A note needs a title');
	// The same reference (e.g. an incident id) in the same section is the same note.
	let note = (id && data.notes.find(n => n.id === id)) || (ref ? data.notes.find(n => n.section === section && n.ref === ref) : null);
	const now = new Date().toISOString();
	if (!note) { note = { id: randomUUID(), addedAt: now }; data.notes.push(note); }
	Object.assign(note, { section, title: title || ref, link, ref, description, due, updatedAt: now });
	await write(data);
	return note;
}

export async function removeNote(id) {
	const data = await read();
	const kept = data.notes.filter(n => n.id !== id);
	const removed = kept.length !== data.notes.length;
	if (removed) { data.notes = kept; await write(data); }
	return { removed };
}
