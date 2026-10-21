// prs render / prs draft: frames for the final video.
// - Several browser processes (screenshots serialize inside one browser): ~4x faster than tabs in one browser.
// - Content-addressed cache: a frame is captured only if no frame with the same DOM fingerprint was captured before
//   (holds, repeated states and unchanged beats from earlier runs cost nothing).
// - Captions are not in these frames: each caption state is captured once and ffmpeg composites them per frame.
// - Motion blur only where the camera moves (canvas mode).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { launch, openVideo } from './browser.mjs';
import { buildDir, findFfmpeg, loadConfig, readJson, sha256, writeJson } from './common.mjs';

const run = promisify(execFile);

function saidCount(chunk, t) {
	let n = 0;
	for (const w of chunk.words) {
		if (t >= w.a - 0.02) {
			n++;
		}
	}
	return n;
}

export function captionStateAt(chunks, t) {
	const c = chunks.findIndex(ch => t >= ch.start && t < ch.end);
	return c < 0 ? null : `${c}-${saidCount(chunks[c], t)}`;
}

function linkOrCopy(from, to) {
	try {
		fs.linkSync(from, to);
	} catch {
		fs.copyFileSync(from, to);
	}
}

export async function render(slug, { draft = false, workers = 0 } = {}) {
	const bdir = buildDir(slug);
	const project = readJson(path.join(bdir, 'project.json'));
	const lock = readJson(path.join(bdir, 'build.lock.json'));
	const fps = draft ? 15 : 30;
	const scale = draft ? 0.5 : 1;
	const total = project.video.total;
	const count = Math.ceil(total * fps);
	const outDir = path.join(bdir, draft ? 'frames-draft' : 'frames');
	const capDir = path.join(bdir, draft ? 'captions-draft' : 'captions');
	const cacheDir = path.join(bdir, 'cache', `x${scale}`);
	fs.rmSync(outDir, { recursive: true, force: true });
	fs.rmSync(capDir, { recursive: true, force: true });
	fs.mkdirSync(outDir, { recursive: true });
	fs.mkdirSync(capDir, { recursive: true });
	fs.mkdirSync(cacheDir, { recursive: true });
	const salt = sha256(fs.readFileSync(path.join(bdir, 'bundle.css')) + String(scale)).slice(0, 16);
	const config = loadConfig();
	const cpus = os.cpus().length;
	const nBrowsers = workers || config.render.workers || Math.max(2, Math.min(8, Math.floor(cpus / 2)));
	const pagesPer = 2;
	const browsers = await Promise.all(Array.from({ length: nBrowsers }, () => launch()));
	const t0 = performance.now();
	let captured = 0, reused = 0, blurred = 0;
	try {
		const first = await openVideo(browsers[0], bdir, { mode: 'content', scale });
		const meta = await first.meta();
		await first.page.close();
		const blurWindows = draft ? [] : meta.blurWindows ?? [];
		const inBlur = t => blurWindows.some(([a, b]) => t > a && t < b);
		const ffmpeg = findFfmpeg();
		// Content frames: contiguous chunks per worker.
		const pages = [];
		for (const b of browsers) {
			for (let i = 0; i < pagesPer; i++) {
				pages.push(openVideo(b, bdir, { mode: 'content', scale }));
			}
		}
		const views = await Promise.all(pages);
		let next = 0;
		const CHUNK = 24;
		const capture = async (v, t) => {
			await v.renderAt(t);
			const sig = await v.page.evaluate(() => window.frameSignature());
			const key = sha256(salt + sig).slice(0, 24);
			const file = path.join(cacheDir, `${key}.png`);
			if (!fs.existsSync(file)) {
				const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
				await v.page.screenshot({ path: tmp, type: 'png' });
				fs.renameSync(tmp, file);
				captured++;
			} else {
				reused++;
			}
			return { key, file };
		};
		await Promise.all(views.map(async v => {
			while (next < count) {
				const start = next;
				next += CHUNK;
				for (let f = start; f < Math.min(count, start + CHUNK); f++) {
					const t = f / fps;
					const out = path.join(outDir, `${String(f).padStart(5, '0')}.png`);
					if (inBlur(t)) {
						// 180-degree shutter sampled six times, averaged: a smooth blur while the camera flies.
						const N = 6;
						const samples = [];
						for (let k = 0; k < N; k++) {
							samples.push(await capture(v, t + (((k + 0.5) / N) - 0.5) * 0.5 / fps));
						}
						const distinct = [...new Set(samples.map(x => x.key))];
						const key = sha256(samples.map(x => x.key).join('|')).slice(0, 24);
						const file = path.join(cacheDir, `mb-${key}.png`);
						if (!fs.existsSync(file)) {
							if (distinct.length === 1) {
								linkOrCopy(samples[0].file, file);
							} else {
								const tmp = `${file}.${process.pid}.tmp.png`;
								await run(ffmpeg, ['-v', 'error', '-y', ...samples.flatMap(x => ['-i', x.file]), '-filter_complex', `mix=inputs=${N}`, '-frames:v', '1', tmp]);
								fs.renameSync(tmp, file);
								blurred++;
							}
						}
						linkOrCopy(file, out);
					} else {
						linkOrCopy((await capture(v, t)).file, out);
					}
				}
			}
		}));
		await Promise.all(views.map(v => v.page.close()));
		// Caption states: one image per (phrase, words said); frames link to them.
		const capView = await openVideo(browsers[0], bdir, { mode: 'captions', scale });
		const chunks = meta.chunks;
		// Playwright clips in CSS pixels; the image comes out at the device scale (960x70 for a draft).
		const band = { x: 0, y: 940, width: 1920, height: 140 };
		const states = new Map();
		const blank = path.join(capDir, 'blank.png');
		await capView.page.evaluate(() => window.showCaption(-1, 0));
		await capView.page.screenshot({ path: blank, clip: band, omitBackground: true });
		for (let f = 0; f < count; f++) {
			const state = captionStateAt(chunks, f / fps);
			let file = blank;
			if (state) {
				if (!states.has(state)) {
					const [c, s] = state.split('-').map(Number);
					const p = path.join(capDir, `state-${state}.png`);
					await capView.page.evaluate(([cc, ss]) => window.showCaption(cc, ss), [c, s]);
					await capView.page.screenshot({ path: p, clip: band, omitBackground: true });
					states.set(state, p);
				}
				file = states.get(state);
			}
			linkOrCopy(file, path.join(capDir, `${String(f).padStart(5, '0')}.png`));
		}
		await capView.page.close();
		const seconds = (performance.now() - t0) / 1000;
		writeJson(path.join(outDir, 'render.json'), {
			slug, fps, scale, count, total, project: lock.project, bundle: lock.bundle, captured, reused, blurred, captionStates: states.size, seconds: +seconds.toFixed(1), browsers: nBrowsers,
		});
		console.log(`rendered ${count} frames in ${seconds.toFixed(1)} s: ${captured} captured, ${reused} reused from cache${blurred ? `, ${blurred} motion-blurred` : ''}; ${states.size} caption states (${nBrowsers} browsers)`);
		if (draft) {
			const { encode } = await import('./encode.mjs');
			const out = path.join(bdir, 'draft.mp4');
			await encode(slug, { draft: true, out });
			console.log(`draft: ${out}`);
		}
	} finally {
		await Promise.all(browsers.map(b => b.close()));
	}
}
