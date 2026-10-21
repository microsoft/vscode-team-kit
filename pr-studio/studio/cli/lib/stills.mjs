// prs stills: key frames of every beat (at its start, each cue and its end) plus a contact sheet.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, openVideo } from './browser.mjs';
import { buildDir, readJson } from './common.mjs';

export function keyTimes(project) {
	const times = new Map();
	const add = (t, why) => {
		const key = +t.toFixed(2);
		if (key >= 0 && key < project.video.total && !times.has(key)) {
			times.set(key, why);
		}
	};
	project.beats.forEach((b, k) => {
		add(k === 0 ? 0 : b.start + 0.6, `${b.id} start`);
		// Just after the cue, but never past the beat's own last moment (into the fade to the next beat or the end card).
		for (const [name, at] of Object.entries(b.cues)) {
			add(Math.min(at + 0.9, b.end - 0.15), `${b.id} \u00b7 ${name}`);
		}
		add(b.end - 0.15, `${b.id} end`);
	});
	add(project.video.endAt + 1.6, 'end card');
	return [...times.entries()].sort((a, b) => a[0] - b[0]).map(([t, why]) => ({ t, why }));
}

/** Writes an HTML grid of images with labels and screenshots it. */
export async function contactSheet(browser, dir, images, out, { cols = 3, width = 640 } = {}) {
	const height = Math.round(width * 9 / 16);
	const cells = images.map(im => `<figure><img src="${pathToFileURL(im.file).href}" width="${width}" height="${height}"><figcaption>${im.label.replace(/</g, '&lt;')}</figcaption></figure>`).join('');
	const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#e9ecf1;font:600 15px -apple-system,Segoe UI,sans-serif;color:#1b1b1f}main{display:grid;grid-template-columns:repeat(${cols},${width}px);gap:14px;padding:14px}figure{margin:0;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}img{display:block}figcaption{padding:7px 10px}</style><main>${cells}</main>`;
	const file = path.join(dir, '.contact.html');
	fs.writeFileSync(file, html);
	const page = await browser.newPage({ viewport: { width: cols * (width + 14) + 14, height: 400 }, deviceScaleFactor: 1 });
	await page.goto(pathToFileURL(file).href);
	await page.screenshot({ path: out, fullPage: true });
	await page.close();
	fs.rmSync(file);
}

export async function stills(slug, { at = null, beat = null, ends = false, scale = 1 } = {}) {
	const bdir = buildDir(slug);
	const project = readJson(path.join(bdir, 'project.json'));
	// --ends: one frame per beat at its fullest moment, half a second before it ends (for a review at full size).
	if (ends) {
		at = project.beats.map(b => +(b.end - 0.5).toFixed(2));
	}
	// A beat or a few times go into their own folder, so the full contact sheet (the one a reviewer reads) stays whole.
	const dir = at || beat ? path.join(bdir, 'stills', beat ? `beat-${beat}` : 'at') : path.join(bdir, 'stills');
	if (at || beat) {
		fs.rmSync(dir, { recursive: true, force: true });
	} else {
		for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
			if (f.endsWith('.png') || f.startsWith('.')) {
				fs.rmSync(path.join(dir, f), { force: true });
			}
		}
	}
	fs.mkdirSync(dir, { recursive: true });
	let list = at ? at.map((t, k) => ({ t, why: ends ? `${project.beats[k].id} end` : `t=${t}` })) : keyTimes(project);
	if (beat) {
		const b = project.beats.find(x => x.id === beat);
		if (!b) {
			throw new Error(`No beat "${beat}"`);
		}
		list = list.filter(x => x.t >= b.start - 0.4 && x.t <= b.end + 0.4);
	}
	const browser = await launch();
	try {
		const workers = Math.min(4, list.length);
		let next = 0;
		const images = [];
		await Promise.all(Array.from({ length: workers }, async () => {
			const v = await openVideo(browser, bdir, { scale });
			while (next < list.length) {
				const item = list[next++];
				await v.renderAt(item.t);
				const file = path.join(dir, `t${item.t.toFixed(2).padStart(6, '0')}.png`);
				await v.page.screenshot({ path: file });
				images.push({ file, label: `${item.t.toFixed(2)} s \u00b7 ${item.why}`, t: item.t });
			}
			await v.page.close();
		}));
		images.sort((a, b) => a.t - b.t);
		const sheet = path.join(dir, 'contact.png');
		await contactSheet(browser, dir, images, sheet);
		return { dir, images, sheet };
	} finally {
		await browser.close();
	}
}
