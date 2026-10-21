// Browser entry. Builds the frame for any time t; the renderer, stills and lint drive it through window.renderAt.
// URL params: mode=all|content|captions  (content = no captions/progress; captions = only the caption pill, transparent)
import '../theme/studio.css';
import { PENDING, el, setFacts } from '../theme/primitives.js';
import { buildChunks, captions } from '../theme/captions.js';
import { chrome } from '../theme/chrome.js';
import { endCard } from '../theme/endcard.js';
import { createStage } from './stage.js';
import { fact } from './text.js';

async function loadFonts() {
	const want = ['400 30px Aptos', '600 30px Aptos', '700 30px Aptos', '400 30px Inter', '600 30px Inter', '700 30px Inter', '400 20px Menlo', '400 20px "JetBrains Mono"', '600 20px "JetBrains Mono"'];
	const loaded = await Promise.all(want.map(f => document.fonts.load(f).catch(() => [])));
	await document.fonts.ready;
	return { aptos: loaded.slice(0, 3).every(list => list.length) };
}

/** cyrb53: fast 53-bit string hash, enough to tell frames apart. */
function hash(str) {
	let h1 = 0xdeadbeef ^ str.length, h2 = 0x41c6ce57 ^ str.length;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export async function start(video, project) {
	const params = new URLSearchParams(location.search);
	const mode = params.get('mode') ?? 'all';
	document.body.classList.add(`mode-${mode}`);
	const fonts = await loadFonts();
	setFacts(project.pr.facts);
	const app = document.getElementById('app');
	const stage = createStage(app, video, project);
	const titleEntry = stage.entries[0];
	const end = endCard(stage.root, project.pr.facts, { headline: titleEntry.spec.params?.headline ?? fact('title') });
	end.layout();
	const { endAt, total } = project.video;
	const ch = chrome(app, { beats: project.beats, endAt, total }, { movingAt: t => stage.movingAt(t) });
	const chunks = buildChunks(project.beats);
	const cap = captions(app, chunks);
	window.__VIDEO_META__ = {
		id: project.id, total, endAt, fps: project.video.fps ?? 30, motion: video.motion, fonts,
		blurWindows: stage.blurWindows, late: stage.late,
		beats: project.beats.map(b => ({ id: b.id, start: b.start, end: b.end, cues: b.cues, treatment: video.beats[b.id].treatment })),
		chunks: chunks.map(c => ({ start: c.start, end: c.end, words: c.words.map(w => ({ a: w.a, b: w.b, display: w.display })) })),
	};
	window.renderAt = t => {
		if (!Number.isFinite(t)) {
			throw new Error('renderAt(t) needs a finite time in seconds');
		}
		stage.render(t);
		window.__moving = stage.movingAt(t);
		end.render(t, endAt);
		ch.render(t);
		cap.render(t);
		// A frame with pictures that are still loading (footage) is ready once they are.
		return PENDING.length ? Promise.all(PENDING.splice(0)) : undefined;
	};
	/** Shows one caption state (chunk c, s words said); c = -1 hides the pill. Used by the caption renderer. */
	window.showCaption = (c, s) => cap.show(c, s);
	/** Fingerprint of everything that paints in content mode; equal fingerprints render equal pixels. */
	window.frameSignature = () => {
		let s = `${mode}|`;
		for (const node of stage.root.querySelectorAll('.st-world, .st-world > *, .st-carry, .st-endcard')) {
			if (node.classList.contains('st-world')) {
				s += node.getAttribute('style') ?? '';
			} else if (node.style.display !== 'none') {
				s += node.outerHTML;
			}
		}
		s += document.querySelector('.st-chrome')?.outerHTML ?? '';
		return hash(s) + s.length.toString(36);
	};
	window.renderAt(Number(params.get('t') ?? 0));
	window.__READY__ = true;
	el('div', '', document.body).id = 'ready';
}
