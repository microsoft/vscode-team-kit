// prs catalog: list the treatments; with --stills, render every treatment's demo into a catalog video, lint it,
// and save one still per treatment (--sheet: all of them on one numbered picture).
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { pathToFileURL } from 'node:url';
import { ROOT, buildDir, videoDir, writeJson } from './common.mjs';
import { NEEDS } from '../../engine/scene.js';

const SLUG = '_catalog';
// The stills go into catalog-stills/ of the engine, or where PRS_CATALOG_OUT says.
const OUT = process.env.PRS_CATALOG_OUT ? path.resolve(process.env.PRS_CATALOG_OUT) : path.join(ROOT, 'catalog-stills');

export async function loadCatalog() {
	const out = path.join(ROOT, 'node_modules', '.cache', 'prs-catalog.mjs');
	await esbuild.build({ preserveSymlinks: true, entryPoints: [path.join(ROOT, 'catalog', 'index.js')], bundle: true, platform: 'node', format: 'esm', outfile: out, loader: { '.svg': 'text', '.css': 'empty' }, logLevel: 'silent' });
	const mod = await import(`${pathToFileURL(out).href}?v=${Date.now()}`);
	const list = [];
	for (const [ns, members] of Object.entries(mod)) {
		for (const [name, factory] of Object.entries(members)) {
			if (factory?.meta) {
				list.push({ ...factory.meta, ns, key: name, call: `${ns}.${name}`, factory });
			}
		}
	}
	return list;
}

export const DEMO_SOURCE = `export class SettingsCache {
	private value: Settings | undefined;

	get(file: URI): Settings {
		if (this.value && !this.isStale(file)) {
			return this.value;
		}
		const text = readFileSync(file);
		this.value = parse(text);
		this.version = statSync(file).mtime;
		return this.value;
	}

	onDidChange(file: URI): void {
		this.value = undefined;
	}
}
`;

export const DEMO_DIFF = `diff --git a/demo/src/cache.ts b/demo/src/cache.ts
--- a/demo/src/cache.ts
+++ b/demo/src/cache.ts
@@ -2,10 +2,11 @@ export class SettingsCache {
 	private value: Settings | undefined;
 
 	get(file: URI): Settings {
-		if (this.value) {
+		if (this.value && !this.isStale(file)) {
 			return this.value;
 		}
 		const text = readFileSync(file);
 		this.value = parse(text);
+		this.version = statSync(file).mtime;
 		return this.value;
 	}
`;

/** Facts of a made-up PR (contoso/example#1234) whose code is DEMO_SOURCE and DEMO_DIFF. */
export function demoFacts() {
	const files = [
		{ path: 'src/settings/cache.ts', additions: 48, deletions: 12, area: 'src/settings', isTest: false, status: 'modified' },
		{ path: 'src/settings/watcher.ts', additions: 22, deletions: 4, area: 'src/settings', isTest: false, status: 'modified' },
		{ path: 'src/ui/statusBar.ts', additions: 31, deletions: 9, area: 'src/ui', isTest: false, status: 'modified' },
		{ path: 'src/settings/test/cache.test.ts', additions: 64, deletions: 0, area: 'src/settings', isTest: true, status: 'added' },
		{ path: 'demo/src/cache.ts', additions: 2, deletions: 1, area: 'demo/src', isTest: false, status: 'modified' },
	];
	const areas = ['src/settings', 'src/ui', 'demo/src'].map(name => {
		const fs2 = files.filter(f => f.area === name);
		return { name, files: fs2.length, additions: fs2.reduce((a, f) => a + f.additions, 0), deletions: fs2.reduce((a, f) => a + f.deletions, 0) };
	});
	return {
		repo: 'contoso/example', number: 1234, url: 'https://github.com/contoso/example/pull/1234', title: 'Cache settings and refresh them when the file changes',
		authorLogin: 'octocat', state: 'OPEN', isDraft: false, createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-02T10:00:00Z', mergedAt: null,
		baseRef: 'main', headRef: 'cache', baseSha: '0'.repeat(40), headSha: 'abc1234def'.padEnd(40, '0'), headSha9: 'abc1234de',
		additions: files.reduce((a, f) => a + f.additions, 0), deletions: files.reduce((a, f) => a + f.deletions, 0), changedFiles: files.length, commitCount: 3,
		reviewDecision: 'REVIEW_REQUIRED', labels: [], fetchedAt: '2026-09-02T12:00:00Z',
		commits: [{ sha9: 'abc1234de', headline: 'Cache settings', message: 'Cache settings' }], files, areas, testFiles: 1, linkedIssues: [], reviewers: [], reviewCount: 0,
	};
}

/** prs catalog [--stills] [--sheet file.png]: the treatments; with --stills, a still of each (its own demo); with
 * --sheet, the stills as one numbered picture instead. */
export async function catalog({ stills = false, only = null, sheet = null, icons = false } = {}) {
	if (icons) {
		// The icons a treatment's `icon` takes (and a slide's, in a deck).
		const { ICON_NAMES } = await import('../../theme/icons.js');
		const names = [...ICON_NAMES].sort();
		console.log(`${names.length} icons: ${names.join(' ')}`);
		return names;
	}
	const list = await loadCatalog();
	if (!stills && !sheet) {
		for (const need of Object.keys(NEEDS)) {
			const items = list.filter(t => t.need === need);
			console.log(`\n${need}: ${NEEDS[need]}`);
			for (const t of items) {
				console.log(`  ${t.call.padEnd(26)} ${t.name} \u2014 ${t.when}`);
				for (const [k, v] of Object.entries(t.params ?? {})) {
					console.log(`      ${k}: ${v}`);
				}
			}
		}
		return list;
	}
	// A demo video with every treatment, built from each treatment's demo params.
	const vdir = videoDir(SLUG), bdir = buildDir(SLUG);
	fs.rmSync(vdir, { recursive: true, force: true });
	fs.mkdirSync(path.join(bdir, 'src', 'abc1234de', 'demo', 'src'), { recursive: true });
	fs.writeFileSync(path.join(bdir, 'src', 'abc1234de', 'demo', 'src', 'cache.ts'), DEMO_SOURCE);
	fs.writeFileSync(path.join(vdir, 'pr.diff'), DEMO_DIFF);
	const facts = demoFacts();
	writeJson(path.join(vdir, 'pr.json'), { facts, body: 'Caches settings in memory and refreshes them when the file changes.', symbols: [], tests: [], tier: { name: 'small', seconds: [40, 55], words: [90, 125], beats: 4, reasons: [] } });
	const chosen = list.filter(t => t.demo && (!only || t.call === only || t.ns === only));
	const filler = 'This sentence only gives the catalog example enough time on screen, so every element can appear at its usual pace before the next one.';
	const beats = chosen.map((t, k) => ({ id: `b${k}`, need: t.need, say: `${t.name}. ${filler}`, cues: {}, claims: [] }));
	if (chosen[0]?.call !== 'title.frame') {
		const title = list.find(t => t.call === 'title.frame');
		chosen.unshift(title);
		beats.unshift({ id: 'title', need: 'title', say: `Title. ${filler}`, cues: {}, claims: [] });
	}
	writeJson(path.join(vdir, 'storyboard.json'), { pr: { repo: facts.repo, number: facts.number }, pronounce: {}, beats });
	const scene = [
		"import { defineVideo } from '../../engine/scene.js';",
		"import * as cat from '../../catalog/index.js';",
		'export default defineVideo({ motion: \'slides\', beats: {',
		...chosen.map((t, k) => `\t${JSON.stringify(beats[k].id)}: cat.${t.call}(cat.${t.call}.meta.demo()),`),
		'} });',
		'',
	].join('\n');
	fs.writeFileSync(path.join(vdir, 'scenes.js'), scene);
	const { prepare } = await import('./prepare.mjs');
	const { project } = await prepare(SLUG, { quiet: true });
	const { lint } = await import('./lint.mjs');
	const ok = await lint(SLUG);
	const { launch, openVideo } = await import('./browser.mjs');
	const out = sheet ? path.join(bdir, 'sheet-stills') : OUT;
	fs.mkdirSync(out, { recursive: true });
	const browser = await launch();
	try {
		const v = await openVideo(browser, bdir, { scale: 0.5 });
		for (const [k, t] of chosen.entries()) {
			const b = project.beats[k];
			await v.renderAt(Math.max(b.start + 0.5, b.end - 0.3));
			await v.page.screenshot({ path: path.join(out, `${t.id}.png`) });
		}
		if (sheet) {
			// One picture, numbered in the order prs catalog lists them.
			const { contactSheet } = await import('./stills.mjs');
			const images = orderOf(list).map((t, k) => ({ file: path.join(out, `${t.id}.png`), label: `${k + 1}  \u00b7  ${t.call}` })).filter(x => fs.existsSync(x.file));
			fs.mkdirSync(path.dirname(path.resolve(sheet)), { recursive: true });
			await contactSheet(browser, out, images, path.resolve(sheet), { cols: 4, width: 480 });
		}
	} finally {
		await browser.close();
	}
	console.log(sheet
		? `${chosen.length} catalog stills on one sheet: ${sheet}${ok ? '' : ' (lint found problems above)'}`
		: `${chosen.length} catalog stills in ${OUT}${ok ? '' : ' (lint found problems above)'}`);
	return list;
}

/** The treatments with a demo, in the order prs catalog lists them (by need). */
function orderOf(list) {
	return Object.keys(NEEDS).flatMap(need => list.filter(t => t.need === need && t.demo));
}
