// Code at the PR head commit: fetch (cached), select lines, mark the lines the PR adds, tokenize with Shiki Light+.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHighlighter } from 'shiki';
import { codeKey } from '../../engine/text.js';
import { ROOT, buildDir, isOffline } from './common.mjs';
import { fileAt } from './github.mjs';

const LANG = {
	ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
	json: 'json', jsonc: 'jsonc', css: 'css', scss: 'scss', less: 'less', html: 'html', md: 'markdown', py: 'python', go: 'go', rs: 'rust',
	java: 'java', cs: 'csharp', cpp: 'cpp', cc: 'cpp', c: 'c', h: 'c', hpp: 'cpp', sh: 'shellscript', bash: 'shellscript', yml: 'yaml', yaml: 'yaml',
	toml: 'toml', rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin', sql: 'sql', xml: 'xml', ps1: 'powershell', bat: 'bat',
};
export const langOf = file => LANG[file.split('.').pop().toLowerCase()] ?? 'text';
const shortLang = file => file.split('.').pop().toLowerCase();

/** Parses a unified diff into per-file hunks with old/new line numbers. */
export function parseDiff(diffText) {
	const files = new Map();
	let current = null, hunk = null, oldN = 0, newN = 0;
	for (const line of diffText.split('\n')) {
		if (line.startsWith('diff --git ')) {
			current = null;
			hunk = null;
			continue;
		}
		const plus = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
		if (plus && !hunk) {
			const p = plus[1].trim();
			current = p === '/dev/null' ? null : { path: p, hunks: [], added: new Set(), removed: 0 };
			if (current) {
				files.set(p, current);
			}
			continue;
		}
		if (line.startsWith('--- ') && !hunk) {
			continue;
		}
		const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
		if (h && current) {
			oldN = Number(h[1]);
			newN = Number(h[2]);
			hunk = { header: h[3].trim(), lines: [] };
			current.hunks.push(hunk);
			continue;
		}
		if (!hunk || !current) {
			continue;
		}
		if (line.startsWith('+')) {
			hunk.lines.push({ type: '+', old: null, new: newN, text: line.slice(1) });
			current.added.add(newN++);
		} else if (line.startsWith('-')) {
			hunk.lines.push({ type: '-', old: oldN++, new: null, text: line.slice(1) });
			current.removed++;
		} else if (line.startsWith(' ')) {
			hunk.lines.push({ type: ' ', old: oldN++, new: newN++, text: line.slice(1) });
		} else if (line.startsWith('\\')) {
			// "\ No newline at end of file"
		} else {
			hunk = null;
		}
	}
	return files;
}

/** Not worth downloading in advance: nobody shows a lock file or a binary in a video. */
const NOT_SHOWN = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock)$|\.(png|jpe?g|gif|ico|webp|bmp|woff2?|ttf|otf|eot|mp3|mp4|webm|wav|zip|gz|tgz|vsix|exe|dll|so|dylib|node|wasm|pdf)$/i;

const sourceFile = (slug, facts, filePath) => path.join(buildDir(slug), 'src', facts.headSha9, filePath);

/**
 * Saves every file the PR changes, at its head commit, where fileAtHead looks first: the rest of the video can then
 * be made without network (PRS_OFFLINE). Removed, binary and lock files are skipped; a file that fails is reported.
 */
export async function cacheChangedFiles(slug, facts, { concurrency = 8 } = {}) {
	const todo = facts.files.filter(f => f.status !== 'removed' && !NOT_SHOWN.test(f.path) && !fs.existsSync(sourceFile(slug, facts, f.path)));
	const failed = [];
	let next = 0;
	const worker = async () => {
		while (next < todo.length) {
			const file = todo[next++];
			try {
				const text = await fileAt(facts.repo, facts.headSha, file.path);
				fs.mkdirSync(path.dirname(sourceFile(slug, facts, file.path)), { recursive: true });
				fs.writeFileSync(sourceFile(slug, facts, file.path), text);
			} catch (error) {
				failed.push({ path: file.path, error: String(error.message).split('\n')[0] });
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
	return { saved: facts.files.filter(f => fs.existsSync(sourceFile(slug, facts, f.path))).length, failed };
}

export function fileAtHead(slug, facts, filePath) {
	const cached = sourceFile(slug, facts, filePath);
	if (fs.existsSync(cached)) {
		return fs.readFileSync(cached, 'utf8');
	}
	if (isOffline()) {
		throw new Error(`${filePath} is not available offline: only the files this PR changes were downloaded before this run (videos/${slug}/build/src/${facts.headSha9}/). Show one of those instead.`);
	}
	let text;
	try {
		text = execFileSync(process.execPath, [path.join(ROOT, 'cli', 'lib', 'fetch-file.mjs'), facts.repo, facts.headSha, filePath], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
	} catch (error) {
		throw new Error(`Cannot read ${filePath} at ${facts.headSha9}: ${String(error.stderr || error.message).trim().slice(0, 300)}`);
	}
	fs.mkdirSync(path.dirname(cached), { recursive: true });
	fs.writeFileSync(cached, text);
	return text;
}

function findBlockEnd(lines, start) {
	let depth = 0, seen = false;
	for (let i = start; i < lines.length; i++) {
		const code = lines[i].replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""').replace(/\/\/.*$/, '');
		for (const ch of code) {
			if (ch === '{') {
				depth++;
				seen = true;
			} else if (ch === '}') {
				depth--;
			}
		}
		if (seen && depth <= 0) {
			return i;
		}
	}
	return Math.min(lines.length - 1, start + 40);
}

function anchorLine(lines, ref) {
	const re = new RegExp(ref.anchor);
	const hits = lines.flatMap((l, i) => (re.test(l) ? [i] : []));
	if (!hits.length) {
		throw new Error(`anchor /${ref.anchor}/ is not in ${ref.file} at the head commit`);
	}
	if (hits.length > 1 && ref.occurrence === undefined) {
		throw new Error(`anchor /${ref.anchor}/ matches ${hits.length} lines of ${ref.file} (${hits.slice(0, 6).map(i => i + 1).join(', ')}); add occurrence: n or a more precise anchor`);
	}
	const i = hits[ref.occurrence ?? 0];
	if (i === undefined) {
		throw new Error(`anchor /${ref.anchor}/ occurrence ${ref.occurrence} not found in ${ref.file}`);
	}
	return i;
}

let highlighterPromise = null;
const loaded = new Set();
async function highlighter(langs) {
	highlighterPromise ??= createHighlighter({ themes: ['light-plus'], langs: [] });
	const h = await highlighterPromise;
	for (const lang of langs) {
		if (lang !== 'text' && !loaded.has(lang)) {
			await h.loadLanguage(lang);
			loaded.add(lang);
		}
	}
	return h;
}

async function tokenize(texts, lang) {
	if (lang === 'text') {
		return texts.map(t => [{ t, c: '#1b1b1f' }]);
	}
	const h = await highlighter([lang]);
	const { tokens } = h.codeToTokens(texts.join('\n'), { lang, theme: 'light-plus' });
	return texts.map((text, i) => {
		const line = (tokens[i] ?? []).map(tk => ({ t: tk.content, c: tk.color ?? '#1b1b1f', ...(tk.fontStyle & 1 ? { i: 1 } : {}), ...(tk.fontStyle & 2 ? { b: 1 } : {}) }));
		if (line.map(x => x.t).join('') !== text) {
			return [{ t: text, c: '#1b1b1f' }];
		}
		return line;
	});
}

const detab = s => s.replace(/\t/g, '  ').replace(/\s+$/, '');

/** Resolves one code() reference to a block (or a diff hunk) for project.json. */
export async function resolveCode(slug, facts, diffFiles, ref) {
	const lang = langOf(ref.file);
	if (ref.diff) {
		const file = diffFiles.get(ref.file);
		if (!file || !file.hunks.length) {
			throw new Error(`${ref.file} has no diff hunks in this PR`);
		}
		let hunk;
		if (ref.anchor) {
			const re = new RegExp(ref.anchor);
			hunk = file.hunks.filter(h => h.lines.some(l => re.test(l.text)))[ref.occurrence ?? 0];
			if (!hunk) {
				throw new Error(`no hunk of ${ref.file} contains /${ref.anchor}/`);
			}
		} else {
			hunk = file.hunks[ref.hunk ?? 0];
			if (!hunk) {
				throw new Error(`${ref.file} has ${file.hunks.length} hunks; hunk ${ref.hunk} does not exist`);
			}
		}
		let lines = hunk.lines;
		if (ref.from || ref.to) {
			const inRange = l => {
				const n = l.new ?? l.old;
				return n >= (ref.from ?? 0) && n <= (ref.to ?? Infinity);
			};
			lines = lines.filter(inRange);
		}
		if (ref.trim !== false) {
			while (lines.length && lines[0].type === ' ' && !lines[0].text.trim()) {
				lines = lines.slice(1);
			}
			while (lines.length && lines.at(-1).type === ' ' && !lines.at(-1).text.trim()) {
				lines = lines.slice(0, -1);
			}
		}
		const texts = lines.map(l => detab(l.text));
		const tokens = await tokenize(texts, lang);
		return { key: codeKey(ref), kind: 'diff', path: ref.file, lang: shortLang(ref.file), header: hunk.header, lines: lines.map((l, i) => ({ type: l.type, old: l.old, new: l.new, text: texts[i], tokens: tokens[i] })) };
	}
	const source = fileAtHead(slug, facts, ref.file).replace(/\r\n/g, '\n').split('\n');
	let from, to;
	if (ref.anchor) {
		const i = anchorLine(source, ref);
		from = i + 1 - (ref.before ?? 0);
		to = ref.block ? findBlockEnd(source, i) + 1 : i + 1 + (ref.after ?? 0);
	} else {
		from = ref.from ?? 1;
		to = ref.to ?? from;
	}
	if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > source.length) {
		throw new Error(`lines ${from}-${to} are outside ${ref.file} (${source.length} lines at the head commit)`);
	}
	if (to - from > 120) {
		throw new Error(`${ref.file}:${from}-${to} is ${to - from + 1} lines; show at most 120`);
	}
	const added = diffFiles.get(ref.file)?.added ?? new Set();
	const texts = source.slice(from - 1, to).map(detab);
	const tokens = await tokenize(texts, lang);
	return {
		key: codeKey(ref), kind: 'code', path: ref.file, lang: shortLang(ref.file), headSha: facts.headSha, startLine: from, endLine: to,
		lines: texts.map((text, i) => ({ n: from + i, text, tokens: tokens[i], changed: added.has(from + i) })),
	};
}
