// Reads the colour theme of the VS Code build hosting this extension, so the panel can match it.
// VS Code stores the resolved theme (`colorThemeData`: type + full colour map) per profile in
// <user-data>/User[/profiles/<id>]/globalStorage/state.vscdb. Canvases open in the Agents window,
// which uses the built-in "agents" profile; other windows use the default profile.
import { DatabaseSync } from 'node:sqlite';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PRODUCT_DIRS = {
	'com.microsoft.VSCodeInsiders': 'Code - Insiders',
	'com.microsoft.VSCode': 'Code',
	'com.microsoft.VSCodeExploration': 'Code - Exploration',
	'com.visualstudio.code.oss': 'Code - OSS',
};

function appSupportDir() {
	if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support');
	if (process.platform === 'win32') return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
	return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function userDirs() {
	const product = PRODUCT_DIRS[process.env.__CFBundleIdentifier];
	const names = product ? [product] : ['Code - Insiders', 'Code'];
	return names.map(n => path.join(appSupportDir(), n, 'User'));
}

// Agents profile first (where canvases live), then the default profile.
function candidateDbs() {
	return userDirs().flatMap(u => [
		path.join(u, 'profiles', 'builtin', 'agents', 'globalStorage', 'state.vscdb'),
		path.join(u, 'globalStorage', 'state.vscdb'),
	]);
}

function readThemeRow(file) {
	const db = new DatabaseSync(file, { readOnly: true });
	try {
		const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'colorThemeData'").get();
		return row ? JSON.parse(String(row.value)) : null;
	} finally {
		db.close();
	}
}

const first = (cm, ...keys) => keys.map(k => cm[k]).find(v => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v));

// Map VS Code theme colours onto the panel's CSS tokens.
function toTokens(data) {
	const cm = data.colorMap || {};
	const base = String(data.id || 'vs-dark').split(' ')[0];
	const dark = base === 'vs-dark' || base === 'hc-black';
	const hc = base.startsWith('hc');
	const fg = first(cm, 'foreground', 'editor.foreground') || (dark ? '#cccccc' : '#333333');
	const surface = first(cm, 'editor.background') || (dark ? '#1e1e1e' : '#ffffff');
	const tokens = {
		'--bg': first(cm, 'sideBar.background', 'panel.background', 'editor.background') || surface,
		'--surface': surface,
		'--surface-2': first(cm, 'editorWidget.background', 'input.background', 'sideBar.background') || surface,
		'--hover': first(cm, 'list.hoverBackground', 'toolbar.hoverBackground') || `color-mix(in srgb, ${fg} 8%, transparent)`,
		'--fg': fg,
		'--muted': first(cm, 'descriptionForeground') || `color-mix(in srgb, ${fg} 70%, transparent)`,
		'--faint': first(cm, 'disabledForeground') || `color-mix(in srgb, ${fg} 50%, transparent)`,
		'--line': first(cm, 'widget.border', 'panel.border', 'editorGroup.border', 'sideBar.border', 'contrastBorder') || `color-mix(in srgb, ${fg} 14%, transparent)`,
		'--accent': first(cm, 'button.background', 'focusBorder', 'textLink.foreground') || '#0078d4',
		'--accent-fg': first(cm, 'button.foreground') || '#ffffff',
		'--link': first(cm, 'textLink.foreground', 'button.background'),
		'--ok': first(cm, 'testing.iconPassed', 'charts.green', 'gitDecoration.addedResourceForeground') || (dark ? '#4ade80' : '#16a34a'),
		'--warn': first(cm, 'editorWarning.foreground', 'charts.yellow', 'list.warningForeground') || (dark ? '#fbbf24' : '#d97706'),
		'--bad': first(cm, 'errorForeground', 'editorError.foreground', 'charts.red') || (dark ? '#f87171' : '#dc2626'),
	};
	tokens['--accent-soft'] = `color-mix(in srgb, ${tokens['--accent']} ${dark ? 22 : 12}%, ${tokens['--surface']})`;
	tokens['--shadow'] = hc ? 'none' : dark ? '0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.25)' : '0 1px 2px rgba(16,24,40,.04), 0 4px 16px rgba(16,24,40,.06)';
	return { name: data.settingsId || data.label || base, base, dark, highContrast: hc, tokens };
}

let cache = { key: '', value: null };
export async function getVsCodeTheme() {
	for (const file of candidateDbs()) {
		const stat = await fs.stat(file).catch(() => null);
		if (!stat) continue;
		const key = `${file}:${stat.mtimeMs}`;
		if (cache.key === key) return cache.value;
		try {
			const data = readThemeRow(file);
			if (!data) continue;
			cache = { key, value: { ...toTokens(data), source: file.includes(`${path.sep}agents${path.sep}`) ? 'Agents window' : 'Default profile' } };
			return cache.value;
		} catch {
			// The database can be briefly locked while VS Code writes; try the next one / next poll.
		}
	}
	return null;
}

// Calls onChange when the theme changes (VS Code writes the profile database shortly after a theme switch).
export function watchVsCodeTheme(onChange, intervalMs = 2000) {
	let last = null;
	let busy = false;
	const tick = async () => {
		if (busy) return;
		busy = true;
		try {
			const t = await getVsCodeTheme();
			const sig = t ? JSON.stringify(t.tokens) : '';
			if (last !== null && sig !== last) onChange(t);
			last = sig;
		} finally {
			busy = false;
		}
	};
	tick();
	const timer = setInterval(tick, intervalMs);
	return () => clearInterval(timer);
}

// VS Code's Layout Density (`window.density.layout`: default | compact; View > Appearance > Layout Density),
// from the user settings, which the Agents window profile shares. Null when no settings file is found.
let densityCache = { key: '', value: null };
export async function getVsCodeDensity() {
	for (const u of userDirs()) {
		const file = path.join(u, 'settings.json');
		const stat = await fs.stat(file).catch(() => null);
		if (!stat) continue;
		const key = `${file}:${stat.mtimeMs}`;
		if (densityCache.key !== key) {
			const text = await fs.readFile(file, 'utf8').catch(() => '');
			densityCache = { key, value: parseLayoutDensity(text) };
		}
		return densityCache.value;
	}
	return null;
}

export function parseLayoutDensity(settingsText) {
	const m = /^[ \t]*"window\.density\.layout"\s*:\s*"(default|compact)"/m.exec(settingsText);
	return m ? m[1] : 'default';
}

export function watchVsCodeDensity(onChange, intervalMs = 2000) {
	let last;
	const tick = async () => {
		const d = await getVsCodeDensity().catch(() => null);
		if (last !== undefined && d !== last) onChange(d);
		last = d;
	};
	tick();
	const timer = setInterval(tick, intervalMs);
	return () => clearInterval(timer);
}
