// A deck's own designs: each file in <deck>/designs/ draws slides no built-in layout can. It exports
//   export function designs(kit) { return { 'deck-name': { render(s, ctx), css, bare, story } }; }
// (kit: the helpers of deck/kit.mjs, so the file needs no import path), or `export const designs = { ... }`.
// A file that doesn't load is reported, not fatal: the rest of the deck still builds.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Soft shadows (with a blur) print as gray boxes in macOS Preview. Returns the blurred shadows found in a CSS text. */
export function blurredShadows(cssText) {
	const found = [];
	cssText.split('\n').forEach((line, i) => {
		for (const m of line.matchAll(/box-shadow:\s*([^;}]+)/g)) {
			const parts = [];
			let depth = 0, cur = '';
			for (const ch of m[1]) {
				depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
				if (ch === ',' && !depth) {
					parts.push(cur);
					cur = '';
				} else {
					cur += ch;
				}
			}
			parts.push(cur);
			for (const sh of parts) {
				const lengths = sh.replace(/[a-z-]+\((?:[^()]|\([^()]*\))*\)/g, ' ').replace(/#[0-9a-f]{3,8}/gi, ' ').split(/\s+/).filter(x => /^-?[\d.]+(px)?$/.test(x));
				if (lengths.length >= 3 && parseFloat(lengths[2]) > 0) {
					found.push(i + 1);
				}
			}
		}
		if (/filter:\s*drop-shadow|text-shadow:\s*[^;]*\d+px\s+\d+px\s+[1-9]/.test(line)) {
			found.push(i + 1);
		}
	});
	return found;
}

/** Every selector of a design's CSS must name the design, so two designs can never change each other's look. */
function unscopedSelectors(name, cssText) {
	const bad = [];
	const text = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
	for (const chunk of text.split('}')) {
		const sel = chunk.split('{')[0].trim();
		if (!sel || sel.startsWith('@') || !chunk.includes('{')) {
			continue;
		}
		for (const one of sel.split(',')) {
			if (!one.includes(`.${name}`)) {
				bad.push(one.trim());
			}
		}
	}
	return bad;
}

/** Loads the designs in <deckDir>/designs/. Returns { designs, owner (design name -> file), css (design name -> its CSS),
 * problems: [{ file, kind, text }] }. */
export async function loadDesigns(deckDir, builtIn, kit) {
	const dir = path.join(deckDir, 'designs');
	const designs = {};
	const owner = {};
	const css = {};
	const problems = [];
	if (!fs.existsSync(dir)) {
		return { designs, owner, css, problems };
	}
	for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.mjs')).sort()) {
		const where = `designs/${file}`;
		let table;
		try {
			const mod = await import(pathToFileURL(path.join(dir, file)).href);
			table = typeof mod.designs === 'function' ? mod.designs(kit) : mod.designs;
		} catch (e) {
			problems.push({ file, kind: `${where} does not load`, text: String(e.message).split('\n')[0].slice(0, 160) });
			continue;
		}
		for (const [name, d] of Object.entries(table ?? {})) {
			if (builtIn[name]) {
				problems.push({ file, kind: `design "${name}" in ${where} has the name of a built-in layout`, text: 'rename it, starting with the deck\'s own prefix' });
				continue;
			}
			if (designs[name]) {
				problems.push({ file, kind: `design "${name}" is defined twice`, text: `designs/${owner[name]} and ${where}` });
				continue;
			}
			if (typeof d?.render !== 'function') {
				problems.push({ file, kind: `design "${name}" in ${where} has no render(s, ctx)`, text: name });
				continue;
			}
			if (/\bs\??\.minutes\b/.test(d.render.toString())) {
				problems.push({ file, kind: `design "${name}" in ${where} reads s.minutes`, text: 'the build counts minutes as the slide\'s speaking time: give the design its own field name' });
			}
			designs[name] = d;
			owner[name] = file;
			if (d.css) {
				for (const sel of unscopedSelectors(name, d.css)) {
					problems.push({ file, kind: `CSS selector in design "${name}" (${where}) doesn't name the design (start its classes with .${name})`, text: sel.slice(0, 120) });
				}
				for (const line of blurredShadows(d.css)) {
					problems.push({ file, kind: `soft shadow in design "${name}" (${where}, CSS line ${line}): PDF viewers draw it as a gray box`, text: 'use none, or a ring without blur' });
				}
				css[name] = `/* ${where}: ${name} */\n${d.css}`;
			}
		}
	}
	return { designs, owner, css, problems };
}
