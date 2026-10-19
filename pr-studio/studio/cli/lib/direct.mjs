// prs direct: choose the treatment for each beat and the motion for the video, then scaffold scenes.js.
// Variety comes from here, not from instructions: choices are seeded per video and weighted away from what the
// last videos used, and scenes.js arrives already calling the chosen treatments.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, sha256, videoDir, writeJson } from './common.mjs';
import { readHistory } from './history.mjs';
import { loadCatalog } from './catalog.mjs';

function rng(seed) {
	let a = parseInt(sha256(String(seed)).slice(0, 8), 16) >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function weighted(random, items) {
	const total = items.reduce((a, x) => a + x.weight, 0);
	let r = random() * total;
	for (const x of items) {
		r -= x.weight;
		if (r <= 0) {
			return x;
		}
	}
	return items.at(-1);
}

/** Converts demo params into scaffold source: same shape, every label a TODO, code refs pointing at a TODO file. */
function toSource(value, indent = '\t\t\t') {
	if (Array.isArray(value)) {
		if (!value.length) {
			return '[]';
		}
		return `[\n${value.map(v => `${indent}\t${toSource(v, `${indent}\t`)},`).join('\n')}\n${indent}]`;
	}
	if (value && typeof value === 'object') {
		if (value.$text === 'fact') {
			return `fact(${JSON.stringify(value.path)}${value.format ? `, { format: ${JSON.stringify(value.format)} }` : ''})`;
		}
		if (value.$text) {
			return 'label(\'TODO\')';
		}
		if (value.$code) {
			return value.diff ? 'code(\'TODO/path/to/file.ts\', { diff: true, anchor: \'TODO\' })' : 'code(\'TODO/path/to/file.ts\', { from: 1, to: 20 })';
		}
		const entries = Object.entries(value);
		return `{ ${entries.map(([k, v]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${toSource(v, indent)}`).join(', ')} }`;
	}
	return JSON.stringify(value);
}

export async function direct(slug, { seed, motion: forcedMotion, use, reason, force = false, fresh = false } = {}) {
	const vdir = videoDir(slug);
	const storyboard = readJson(path.join(vdir, 'storyboard.json'));
	const beats = storyboard.beats;
	if (beats[0]?.need !== 'title') {
		throw new Error('The first beat must have need "title"');
	}
	const bad = beats.filter(b => !b.need || b.need === 'TODO');
	if (bad.length) {
		throw new Error(`Set the need of every beat first (${bad.map(b => b.id).join(', ')}). Needs: concept, exchange, flow, rules, compare, architecture, code, numbers, state, ui, status.`);
	}
	const catalog = await loadCatalog();
	const history = readHistory().filter(e => e.slug !== slug);
	const recent = history.slice(-3).reverse();
	const lastUse = new Map();
	recent.forEach((e, age) => {
		for (const t of Object.values(e.treatments)) {
			if (!lastUse.has(t)) {
				lastUse.set(t, age);
			}
		}
	});
	// A second run keeps what the first picked (--use and --motion change only what they name; a new beat gets a pick):
	// videos published meanwhile don't re-roll a direction the scenes are already written for. --fresh picks again.
	const previous = !fresh && fs.existsSync(path.join(vdir, 'direction.json')) ? readJson(path.join(vdir, 'direction.json')) : null;
	const random = rng(seed ?? previous?.seed ?? `${slug}:${history.length}`);
	const overrides = {};
	for (const pair of String(use ?? '').split(',').filter(Boolean)) {
		const [id, treatment] = pair.split('=');
		if (!catalog.some(t => t.id === treatment)) {
			throw new Error(`--use ${pair}: no treatment "${treatment}" (see prs catalog)`);
		}
		if (!reason) {
			throw new Error('--use needs --reason "why the picked treatment does not fit"');
		}
		overrides[id] = { treatment, reason };
	}
	const chosen = {};
	const usedHere = new Set();
	for (const b of beats) {
		if (overrides[b.id]) {
			chosen[b.id] = { need: b.need, treatment: overrides[b.id].treatment, why: `override: ${overrides[b.id].reason}` };
			usedHere.add(overrides[b.id].treatment);
			continue;
		}
		if (b.footage) {
			chosen[b.id] = { need: b.need, treatment: 'ui.footage', why: 'footage of the real app ("footage": true)' };
			continue;
		}
		const kept = previous?.beats?.[b.id];
		if (kept && kept.need === b.need && kept.treatment !== 'ui.footage' && catalog.some(t => t.id === kept.treatment)) {
			chosen[b.id] = kept;
			usedHere.add(kept.treatment);
			if (previous.overrides?.[b.id]) {
				overrides[b.id] = previous.overrides[b.id];
			}
			continue;
		}
		const options = catalog.filter(t => t.need === b.need && t.id !== 'ui.footage');
		if (!options.length) {
			throw new Error(`No treatment for need "${b.need}" (beat ${b.id})`);
		}
		const scored = options.map(t => {
			const age = lastUse.get(t.id);
			let weight = age === 0 ? 0.15 : age === 1 ? 0.45 : age === 2 ? 0.7 : 1;
			if (usedHere.has(t.id)) {
				weight *= 0.05;
			}
			return { t, weight, age };
		});
		const pick = weighted(random, scored);
		usedHere.add(pick.t.id);
		chosen[b.id] = { need: b.need, treatment: pick.t.id, why: pick.age === undefined ? 'not used in recent videos' : `used ${pick.age + 1} video${pick.age ? 's' : ''} ago; fewest alternatives` };
	}
	const lastMotion = recent[0]?.motion;
	const motions = [{ id: 'slides', weight: lastMotion === 'slides' ? 0.4 : 1 }, { id: 'canvas', weight: lastMotion === 'canvas' ? 0.4 : 1 }];
	const motion = forcedMotion ?? previous?.motion ?? weighted(random, motions).id;
	const layouts = ['row', 'column', 'grid'];
	const layout = motion !== 'canvas' ? undefined : previous?.motion === 'canvas' && previous.layout ? previous.layout : layouts[Math.floor(random() * layouts.length)];
	const direction = { seed: seed ?? previous?.seed ?? `${slug}:${history.length}`, motion, ...(layout ? { layout } : {}), beats: chosen, overrides, pickedAt: new Date().toISOString() };
	writeJson(path.join(vdir, 'direction.json'), direction);

	const scenes = path.join(vdir, 'scenes.js');
	if (fs.existsSync(scenes) && !force) {
		console.log(`direction.json written; scenes.js exists, left as is (prs direct --force rewrites it)`);
	} else {
		const used = [...new Set(Object.values(chosen).map(c => c.treatment.split('.')[0]))].sort();
		// The code treatments get another name in scenes.js: `code` is already the code() helper from engine/text.js.
		const local = ns => (ns === 'code' ? 'codeSlides' : ns);
		const lines = [
			`// ${storyboard.pr?.repo ?? ''}#${storyboard.pr?.number ?? ''}: scenes chosen by prs direct (motion: ${motion}${layout ? `, layout: ${layout}` : ''}).`,
			'// Fill every TODO from the PR (brief.md, pr.diff). On-screen text: label() for your words, fact() for PR numbers,',
			'// quote() for exact PR text, ident() for code names, code() for source lines. Times: a cue name, word(\'...\'), or seconds.',
			'import { defineVideo, word, cue } from \'../../engine/scene.js\';',
			'import { label, fact, quote, ident, code, path } from \'../../engine/text.js\';',
			`import { ${used.map(ns => (local(ns) === ns ? ns : `${ns} as ${local(ns)}`)).join(', ')} } from '../../catalog/index.js';`,
			'',
			'export default defineVideo({',
			`\tmotion: '${motion}',${layout ? `\n\tlayout: '${layout}',` : ''}`,
			'\tbeats: {',
		];
		for (const b of beats) {
			const c = chosen[b.id];
			const t = catalog.find(x => x.id === c.treatment);
			lines.push('');
			lines.push(`\t\t// ${b.id} (${b.need}) -> ${t.id}: ${t.name}. ${t.when}`);
			for (const [k, v] of Object.entries(t.params ?? {})) {
				lines.push(`\t\t//   ${k}: ${v}`);
			}
			lines.push(`\t\t// says: "${b.say.length > 150 ? `${b.say.slice(0, 150)}\u2026` : b.say}"  cues: ${Object.keys(b.cues ?? {}).join(', ') || '(none)'}`);
			if (t.id === 'ui.footage') {
				const names = Object.keys(b.cues ?? {});
				const marks = `{ ${(names.length ? names : ['TODO']).map(n => `${JSON.stringify(n)}: ${JSON.stringify(n)}`).join(', ')} }`;
				lines.push(`\t\t// name each k.mark() in the capture after the cue it plays at; drop before: if nothing changed visibly`);
				lines.push(`\t\t${JSON.stringify(b.id)}: ui.footage({ eyebrow: label('TODO'), title: label('TODO'), before: { src: 'footage/before.webm', marks: ${marks} }, after: { src: 'footage/after.webm', marks: ${marks} } }),`);
				continue;
			}
			const demo = t.id === 'title.frame' ? { headline: { $text: 'label' } } : t.demo?.() ?? {};
			lines.push(`\t\t${JSON.stringify(b.id)}: ${local(t.ns)}.${t.key}(${toSource(demo)}),`);
		}
		lines.push('\t},', '});', '');
		fs.writeFileSync(scenes, lines.join('\n'));
		console.log(`scenes.js scaffolded: fill in every TODO`);
	}
	console.log(`motion: ${motion}${layout ? ` (${layout})` : ''}`);
	for (const b of beats) {
		console.log(`  ${b.id.padEnd(14)} ${b.need.padEnd(13)} ${chosen[b.id].treatment.padEnd(22)} ${chosen[b.id].why}`);
	}
	return direction;
}
