// Screenshots pasted into the panel's chat boxes. Messages reach chats as text (the panel's chat forwards
// them with send_message), so images are saved here, privately, and the message carries their paths.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataDir } from './config.mjs';

const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const NAME_RE = /^[0-9a-f-]{36}\.(png|jpg|gif|webp)$/;
const KEEP_DAYS = 30;

export function attachmentsDir() {
	return path.join(dataDir(), 'attachments');
}

/** Save a pasted image (base64) and return its name. */
export async function saveImage(mimeType, base64) {
	const ext = TYPES[mimeType];
	if (!ext) throw Object.assign(new Error('only PNG, JPEG, GIF or WebP images'), { status: 400 });
	if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw Object.assign(new Error('invalid image data'), { status: 400 });
	const bytes = Buffer.from(base64, 'base64');
	if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw Object.assign(new Error('image must be at most 8 MB'), { status: 400 });
	const dir = attachmentsDir();
	await fs.mkdir(dir, { recursive: true, mode: 0o700 });
	const name = `${randomUUID()}.${ext}`;
	await fs.writeFile(path.join(dir, name), bytes, { mode: 0o600 });
	pruneOld().catch(() => { });
	return name;
}

/** Absolute paths for attachment names from the panel; unknown or malformed names are dropped. */
export async function imagePaths(names) {
	const out = [];
	for (const name of Array.isArray(names) ? names.slice(0, 6) : []) {
		if (typeof name !== 'string' || !NAME_RE.test(name)) continue;
		const file = path.join(attachmentsDir(), name);
		if (await fs.stat(file).catch(() => null)) out.push(file);
	}
	return out;
}

async function pruneOld() {
	const dir = attachmentsDir();
	const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
	for (const name of await fs.readdir(dir)) {
		if (!NAME_RE.test(name)) continue;
		const st = await fs.stat(path.join(dir, name)).catch(() => null);
		if (st && st.mtimeMs < cutoff) await fs.unlink(path.join(dir, name)).catch(() => { });
	}
}
