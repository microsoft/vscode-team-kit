// Resolves the Agents window chat background (`chat.agentSessions.preferred{Light,Dark}BackgroundImage[Layout]`) the way
// VS Code's SessionsChatBackgroundService does, so the canvas can paint the same background behind its content.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IMAGE_SETTING = { light: 'chat.agentSessions.preferredLightBackgroundImage', dark: 'chat.agentSessions.preferredDarkBackgroundImage' };
export const LAYOUT_SETTING = { light: 'chat.agentSessions.preferredLightBackgroundImageLayout', dark: 'chat.agentSessions.preferredDarkBackgroundImageLayout' };

// Same table as VS Code's backgroundImageStyles; unknown or unset layouts are `repeat`.
export const LAYOUTS = {
	repeat: { repeat: 'repeat', size: 'auto', position: 'left top' },
	stretch: { repeat: 'no-repeat', size: '100% 100%', position: 'center center' },
	center: { repeat: 'no-repeat', size: 'auto', position: 'center center' },
	top: { repeat: 'no-repeat', size: 'auto', position: 'center top' },
	'top-right': { repeat: 'no-repeat', size: 'auto', position: 'right top' },
	'top-left': { repeat: 'no-repeat', size: 'auto', position: 'left top' },
	bottom: { repeat: 'no-repeat', size: 'auto', position: 'center bottom' },
	'bottom-right': { repeat: 'no-repeat', size: 'auto', position: 'right bottom' },
	'bottom-left': { repeat: 'no-repeat', size: 'auto', position: 'left bottom' },
	left: { repeat: 'no-repeat', size: 'auto', position: 'left center' },
	right: { repeat: 'no-repeat', size: 'auto', position: 'right center' },
};

/** The image formats a chat background can display (VS Code's chatBackgroundImageExtensions), with their content types. */
export const IMAGE_TYPES = {
	avif: 'image/avif', bmp: 'image/bmp', gif: 'image/gif', ico: 'image/x-icon', jpeg: 'image/jpeg', jpg: 'image/jpeg',
	png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp',
};

const MEDIA = ['vs', 'sessions', 'services', 'chatBackground', 'browser', 'media'];

/** An absolute path, a `file` URI, or (like VS Code's lenient URI.parse) a scheme-less value taken as a root path. */
function toFile(value) {
	if (path.isAbsolute(value)) {
		return value;
	}
	const scheme = /^([a-z][\w+.-]*):/i.exec(value)?.[1];
	if (!scheme) {
		return path.posix.join('/', value);
	}
	if (scheme.toLowerCase() !== 'file') {
		return undefined;
	}
	try {
		return fileURLToPath(value);
	} catch {
		return undefined;
	}
}

/**
 * What the chat shows for a theme: undefined when unset or in high contrast, `codicons`, or an image file (the
 * built-in koi images live in the VS Code app under `appOut`, with a static version for reduced motion).
 */
export function resolveChatBackground(settings, themeBase, appOut) {
	if (String(themeBase).startsWith('hc')) {
		return undefined;
	}
	const scheme = themeBase === 'vs-dark' ? 'dark' : 'light';
	const raw = settings?.[IMAGE_SETTING[scheme]];
	const value = typeof raw === 'string' ? raw.trim() : '';
	if (!value) {
		return undefined;
	}
	if (value === 'codicons') {
		return { kind: 'codicons', font: appOut ? path.join(appOut, 'media', 'codicon.ttf') : undefined };
	}
	const layoutValue = settings?.[LAYOUT_SETTING[scheme]];
	const layout = Object.hasOwn(LAYOUTS, layoutValue) ? layoutValue : 'repeat';
	if (value === 'koi-light' || value === 'koi-dark') {
		const media = appOut ? path.join(appOut, ...MEDIA) : undefined;
		return { kind: 'image', preset: value, layout, file: media && path.join(media, `${value}.webp`), reducedMotionFile: media && path.join(media, `${value}-static.webp`) };
	}
	const file = toFile(value);
	return file ? { kind: 'image', layout, file } : undefined;
}

/** Content type of a background image file, or undefined for formats a chat background does not display. */
export function imageType(file) {
	return IMAGE_TYPES[path.extname(file ?? '').slice(1).toLowerCase()];
}

/** Parses settings.json (JSON with comments and trailing commas). */
export function parseJsonc(text) {
	let out = '';
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '"') {
			const start = i;
			for (i++; i < text.length && text[i] !== '"'; i++) {
				if (text[i] === '\\') {
					i++;
				}
			}
			out += text.slice(start, i + 1);
		} else if (c === '/' && text[i + 1] === '/') {
			while (i < text.length && text[i] !== '\n') {
				i++;
			}
			out += '\n';
		} else if (c === '/' && text[i + 1] === '*') {
			const end = text.indexOf('*/', i + 2);
			i = end < 0 ? text.length : end + 1;
		} else {
			if (c === '}' || c === ']') {
				const trimmed = out.trimEnd();
				if (trimmed.endsWith(',')) {
					out = trimmed.slice(0, -1);
				}
			}
			out += c;
		}
	}
	return JSON.parse(out);
}

const fileCache = new Map();
/** Reads and parses a file again only when its mtime changes. */
async function readCached(file, parse) {
	const stat = await fs.stat(file).catch(() => null);
	if (!stat) {
		fileCache.delete(file);
		return undefined;
	}
	const cached = fileCache.get(file);
	if (cached?.mtimeMs === stat.mtimeMs) {
		return cached.value;
	}
	let value;
	try {
		value = parse(await fs.readFile(file, 'utf8'));
	} catch {
		// Mid-write or invalid: keep the last good value until the next change.
		return cached?.value;
	}
	fileCache.set(file, { mtimeMs: stat.mtimeMs, value });
	return value;
}

/**
 * The settings file a window of the profile reads. The Agents window uses the built-in agents profile, which shares the
 * default profile's settings unless the profile has its own (the chat background settings are machine scoped).
 */
export async function settingsFile(userDir, agentsProfile) {
	if (agentsProfile) {
		const storage = await readCached(path.join(userDir, 'globalStorage', 'storage.json'), text => JSON.parse(text).userDataProfiles ?? []);
		const agents = storage?.find?.(profile => profile?.location === 'builtin/agents');
		if (agents && !agents.useDefaultFlags?.settings) {
			return path.join(userDir, 'profiles', 'builtin', 'agents', 'settings.json');
		}
	}
	return path.join(userDir, 'settings.json');
}

const APP_NAMES = {
	'Code - Insiders': { mac: 'Visual Studio Code - Insiders', win: 'Microsoft VS Code Insiders', linux: 'code-insiders' },
	'Code': { mac: 'Visual Studio Code', win: 'Microsoft VS Code', linux: 'code' },
	'Code - Exploration': { mac: 'Visual Studio Code - Exploration', win: 'Microsoft VS Code Exploration', linux: 'code-exploration' },
	'Code - OSS': { mac: 'Code - OSS', win: 'Code - OSS', linux: 'code-oss' },
};

/** The `out` folder of the installed VS Code app whose user data is `userDir`, or undefined if it cannot be found. */
export async function findAppOut(userDir) {
	const names = APP_NAMES[path.basename(path.dirname(userDir))];
	if (!names) {
		return undefined;
	}
	const candidates = process.platform === 'darwin'
		? ['/Applications', path.join(os.homedir(), 'Applications')].map(dir => path.join(dir, `${names.mac}.app`, 'Contents', 'Resources', 'app', 'out'))
		: process.platform === 'win32'
			? [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', names.win), process.env.ProgramFiles && path.join(process.env.ProgramFiles, names.win)].filter(Boolean).map(dir => path.join(dir, 'resources', 'app', 'out'))
			: ['/usr/share', '/opt'].map(dir => path.join(dir, names.linux, 'resources', 'app', 'out'));
	for (const out of candidates) {
		if (await fs.stat(path.join(out, ...MEDIA)).then(stat => stat.isDirectory(), () => false)) {
			return out;
		}
	}
	return undefined;
}

async function fileVersion(file) {
	const stat = file ? await fs.stat(file).catch(() => null) : null;
	return stat?.isFile() ? `${Math.round(stat.mtimeMs).toString(36)}${stat.size.toString(36)}` : undefined;
}

/** Files the server may serve for the current background, by route name. Nothing else is reachable. */
let servedFiles = {};

export function chatBackgroundFile(name) {
	return Object.hasOwn(servedFiles, name) ? servedFiles[name] : undefined;
}

/**
 * The background for the page: `{ kind: 'image', url, reducedMotionUrl?, layout, repeat, size, position }`,
 * `{ kind: 'codicons', fontUrl }`, or null when VS Code shows none or its files are missing or not displayable.
 */
export async function readChatBackground(userDir, agentsProfile, themeBase) {
	const settings = await readCached(await settingsFile(userDir, agentsProfile), parseJsonc);
	const needsApp = ['codicons', 'koi-light', 'koi-dark'].includes(String(settings?.[IMAGE_SETTING[themeBase === 'vs-dark' ? 'dark' : 'light']] ?? '').trim());
	const resolved = resolveChatBackground(settings, themeBase, needsApp ? await findAppOut(userDir) : undefined);
	servedFiles = {};
	if (resolved?.kind === 'codicons') {
		const version = await fileVersion(resolved.font);
		if (!version) {
			return null;
		}
		servedFiles = { font: { file: resolved.font, type: 'font/ttf' } };
		return { kind: 'codicons', fontUrl: `/api/chat-background/font?v=${version}` };
	}
	if (resolved?.kind !== 'image') {
		return null;
	}
	const type = imageType(resolved.file);
	const version = type && await fileVersion(resolved.file);
	if (!version) {
		return null;
	}
	servedFiles = { image: { file: resolved.file, type } };
	const background = { kind: 'image', url: `/api/chat-background/image?v=${version}`, layout: resolved.layout, ...LAYOUTS[resolved.layout] };
	const reducedVersion = await fileVersion(resolved.reducedMotionFile);
	if (reducedVersion) {
		servedFiles.reduced = { file: resolved.reducedMotionFile, type: imageType(resolved.reducedMotionFile) };
		background.reducedMotionUrl = `/api/chat-background/reduced?v=${reducedVersion}`;
	}
	return background;
}
