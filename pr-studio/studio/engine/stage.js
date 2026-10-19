// The stage: mounts every beat's treatment and moves between beats according to the video's motion mode.
//   slides  one slide per beat; the outgoing slide is gone before the next appears
//   canvas  every beat is a panel on one board; the camera flies from panel to panel (layout: row, column, grid)
//   morph   slides, plus one carried object that flies from an anchor in one beat to an anchor in the next
import { el, pill } from '../theme/primitives.js';
import { FILL } from '../theme/tokens.js';
import { clamp, decel, easeInOutCubic, lerp, prog, standard } from './motion.js';
import { codeKey } from './text.js';

const PANEL_GAP = 220;
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9/.-]/g, '');

function panelPosition(layout, k) {
	if (layout === 'column') {
		return { x: 0, y: k * (1080 + PANEL_GAP) };
	}
	if (layout === 'grid') {
		const row = Math.floor(k / 3), col = k % 3;
		const c = row % 2 === 0 ? col : 2 - col;
		return { x: c * (1920 + PANEL_GAP), y: row * (1080 + PANEL_GAP) };
	}
	return { x: k * (1920 + PANEL_GAP), y: 0 };
}

/** Resolves a timing reference inside a beat to absolute seconds; every explicit time is recorded for the lint. */
function makeAt(beat, seen) {
	const at = (ref, fallback) => {
		const t = resolve(ref, fallback);
		if (ref !== undefined && ref !== null) {
			seen.push({ t, ref: typeof ref === 'object' ? JSON.stringify(ref) : String(ref) });
		}
		return t;
	};
	const resolve = (ref, fallback) => {
		if (ref === undefined || ref === null) {
			if (fallback === undefined) {
				throw new Error(`Beat "${beat.id}": a time is required`);
			}
			return at(fallback);
		}
		if (typeof ref === 'number') {
			return beat.start + ref;
		}
		if (ref === undefined || ref === null) {
			return resolve(fallback);
		}
		if (typeof ref === 'string') {
			if (!Object.hasOwn(beat.cues, ref)) {
				throw new Error(`Beat "${beat.id}": unknown cue "${ref}". Cues: ${Object.keys(beat.cues).join(', ') || '(none)'}. Add it to the storyboard or use word('...').`);
			}
			return beat.cues[ref];
		}
		if (ref.$cue !== undefined) {
			return resolve(ref.$cue) + (ref.offset ?? 0);
		}
		if (ref.$word !== undefined) {
			const want = norm(ref.$word);
			// The word itself first ('To' is "to", not "tool"); a prefix only when the word isn't there whole.
			const exact = beat.words.filter(w => norm(w.display) === want);
			const hits = exact.length > (ref.nth ?? 0) ? exact : beat.words.filter(w => norm(w.display).startsWith(want));
			const hit = hits[ref.nth ?? 0];
			if (!hit) {
				throw new Error(`Beat "${beat.id}": word "${ref.$word}" (#${ref.nth ?? 0}) is not in its narration`);
			}
			return hit.a + (ref.offset ?? 0);
		}
		throw new Error(`Beat "${beat.id}": cannot read time ${JSON.stringify(ref)}`);
	};
	return at;
}

export function createStage(app, video, project) {
	const { endAt } = project.video;
	const motion = video.motion;
	const layout = video.layout ?? 'row';
	const root = el('div', 'st-stage', app);
	const world = el('div', 'st-world', root);
	const panels = project.beats.map((_, k) => (motion === 'canvas' ? panelPosition(layout, k) : { x: 0, y: 0 }));
	const extent = panels.reduce((a, p) => ({ w: Math.max(a.w, p.x + 1920), h: Math.max(a.h, p.y + 1080) }), { w: 1920, h: 1080 });
	let board = null;
	if (motion === 'canvas') {
		board = el('div', 'st-abs', world, {
			left: -600, top: -600, width: extent.w + 1200, height: extent.h + 1200, opacity: 0,
			backgroundImage: 'radial-gradient(circle, #d9dee6 1.6px, transparent 2px)', backgroundSize: '44px 44px',
		});
	}
	const carryLayer = el('div', 'st-layer', root);
	const anchors = new Map();
	const entries = project.beats.map((beat, index) => {
		const spec = video.beats[beat.id];
		if (!spec) {
			throw new Error(`scenes.js has no beat "${beat.id}" (storyboard beats: ${project.beats.map(b => b.id).join(', ')})`);
		}
		const host = el('section', 'st-beat', world, { left: panels[index].x, top: panels[index].y });
		host.dataset.beat = beat.id;
		let frame = null;
		if (motion === 'canvas') {
			frame = el('div', 'st-abs', host, { left: 0, top: 0, width: 1920, height: 1080, borderRadius: 32, border: '2px solid #dfe3ea', background: '#fff', opacity: 0 });
		}
		const content = el('div', 'st-layer', host);
		const seen = [];
		const ctx = {
			beat: { ...beat, index, duration: beat.end - beat.start, need: spec.need },
			at: makeAt(beat, seen),
			has: name => Object.hasOwn(beat.cues, name),
			facts: project.pr.facts,
			code(ref) {
				const block = project.code?.[codeKey(ref)];
				if (!block) {
					throw new Error(`Beat "${beat.id}": code ${ref.file} is not prepared. Run prs prepare.`);
				}
				return block;
			},
			anchor(name, node) {
				anchors.set(`${beat.id}:${name}`, node);
				return node;
			},
			motion,
			video,
			project,
		};
		let instance;
		try {
			instance = spec.impl.mount(content, spec.params ?? {}, ctx) ?? {};
		} catch (error) {
			throw new Error(`Beat "${beat.id}" (${spec.treatment}): ${error.message}`);
		}
		return { beat, spec, host, frame, content, ctx, instance, panel: panels[index], seen };
	});
	// Anything timed after its beat starts leaving is never seen: report it.
	const late = [];
	entries.forEach((entry, k) => {
		const leaves = k === entries.length - 1 ? endAt - 0.25 : entry.beat.end - (motion === 'canvas' ? 0.15 : 0.08);
		for (const s of entry.seen) {
			if (s.t > leaves - 0.3) {
				late.push({ beat: entry.beat.id, at: +s.t.toFixed(2), leaves: +leaves.toFixed(2), ref: s.ref });
			}
		}
	});
	for (const entry of entries) {
		try {
			entry.instance.layout?.();
		} catch (error) {
			throw new Error(`Beat "${entry.beat.id}" (${entry.spec.treatment}) layout: ${error.message}`);
		}
	}
	// Treatments lay their parts out at fixed sizes from the top of the content area, so a short body leaves the lower
	// half of the frame empty. Fit each body (not the heading, not the title frame) to the room above the captions.
	if (video.fill !== false) {
		for (const entry of entries) {
			if (entry.spec.need !== 'title') {
				fillBody(entry);
			}
		}
	}

	// morph: a carried object flies between anchors of consecutive beats
	const carry = video.carry;
	const flights = [];
	let carryNode = null;
	if (motion === 'morph' && carry) {
		carryNode = el('div', 'st-carry', carryLayer);
		carryNode.dataset.flight = 'carry';
		pill(carryNode, { tone: carry.tone ?? 'blue', text: carry.text, iconName: carry.icon, size: 'l', style: { boxShadow: '0 10px 30px rgba(0, 95, 184, .18)' } });
		const rectOf = (id, name) => {
			const node = anchors.get(`${id}:${name}`);
			if (!node) {
				throw new Error(`carry: beat "${id}" has no anchor "${name}"`);
			}
			const r = node.getBoundingClientRect();
			return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
		};
		const ids = entries.map(e => e.beat.id).filter(id => carry.anchors?.[id]);
		for (let i = 0; i + 1 < ids.length; i++) {
			const a = entries.find(e => e.beat.id === ids[i]);
			const b = entries.find(e => e.beat.id === ids[i + 1]);
			if (b.ctx.beat.index !== a.ctx.beat.index + 1) {
				continue;
			}
			flights.push({ t0: a.beat.end - 0.12, t1: b.beat.start + 0.55, from: rectOf(a.beat.id, carry.anchors[a.beat.id]), to: rectOf(b.beat.id, carry.anchors[b.beat.id]) });
		}
	}

	// canvas: camera moves between panels
	const moves = [];
	if (motion === 'canvas') {
		for (let k = 1; k < entries.length; k++) {
			const a = entries[k - 1], b = entries[k];
			const ca = { x: a.panel.x + 960, y: a.panel.y + 540 }, cb = { x: b.panel.x + 960, y: b.panel.y + 540 };
			const dist = Math.hypot(cb.x - ca.x, cb.y - ca.y);
			moves.push({ t0: a.beat.end - 0.15, t1: b.beat.start + 0.6, ca, cb, dip: Math.min(0.3, 0.12 + dist / 16000) });
		}
	}
	const blurWindows = moves.map(m => [m.t0, m.t1]);

	function cameraAt(t) {
		let c = { x: entries[0].panel.x + 960, y: entries[0].panel.y + 540 }, z = 1, moving = 0;
		for (const m of moves) {
			if (t >= m.t1) {
				c = m.cb;
			} else if (t > m.t0) {
				const p = standard(prog(t, m.t0, m.t1));
				c = { x: lerp(m.ca.x, m.cb.x, p), y: lerp(m.ca.y, m.cb.y, p) };
				z = 1 - m.dip * Math.sin(Math.PI * p);
				moving = Math.sin(Math.PI * prog(t, m.t0, m.t1));
				break;
			}
		}
		return { c, z, moving };
	}

	function slideStyle(entry, t, k) {
		const { beat } = entry;
		const last = k === entries.length - 1;
		const exitStart = last ? endAt - 0.25 : beat.end - 0.08;
		const visible = t >= beat.start - 0.35 && t <= exitStart + 0.45;
		const inP = k === 0 ? 1 : easeInOutCubic(clamp((prog(t, beat.start - 0.28, beat.start + 0.34) - 0.3) / 0.7));
		const outP = easeInOutCubic(clamp(prog(t, exitStart, exitStart + 0.4) * 1.7));
		return { visible, opacity: inP * (1 - outP), y: lerp(10, 0, inP) - 8 * outP };
	}

	return {
		root, entries, blurWindows, anchors, late,
		/** 0..1: how much the camera is moving at t (canvas mode), so fixed chrome can step aside. */
		movingAt(t) {
			return motion === 'canvas' ? cameraAt(t).moving : 0;
		},
		render(t) {
			if (motion === 'canvas') {
				const cam = cameraAt(t);
				world.style.transform = `translate(${960 - cam.c.x * cam.z}px, ${540 - cam.c.y * cam.z}px) scale(${cam.z})`;
				board.style.opacity = String(cam.moving * 0.9);
				const lastExit = decel(prog(t, endAt - 0.25, endAt + 0.25));
				entries.forEach((entry, k) => {
					const { panel } = entry;
					const sx = (panel.x - cam.c.x) * cam.z + 960, sy = (panel.y - cam.c.y) * cam.z + 540;
					const visible = sx < 1920 + 40 && sx + 1920 * cam.z > -40 && sy < 1080 + 40 && sy + 1080 * cam.z > -40 && !(k === entries.length - 1 && lastExit >= 1);
					entry.host.style.display = visible ? 'block' : 'none';
					entry.host.style.opacity = k === entries.length - 1 ? String(1 - lastExit) : '1';
					entry.frame.style.opacity = String(cam.moving);
					if (visible) {
						entry.spec.impl.render(entry.instance, t, entry.ctx);
					}
				});
			} else {
				entries.forEach((entry, k) => {
					const s = slideStyle(entry, t, k);
					entry.host.style.display = s.visible ? 'block' : 'none';
					if (!s.visible) {
						return;
					}
					entry.host.style.opacity = String(s.opacity);
					entry.host.style.transform = `translate3d(0, ${s.y}px, 0)`;
					entry.spec.impl.render(entry.instance, t, entry.ctx);
				});
			}
			if (carryNode) {
				const f = flights.find(fl => t > fl.t0 && t < fl.t1);
				carryNode.style.display = f ? 'block' : 'none';
				if (f) {
					const p = standard(prog(t, f.t0, f.t1));
					const w = carryNode.offsetWidth, h = carryNode.offsetHeight;
					const x = lerp(f.from.cx, f.to.cx, p) - w / 2;
					const y = lerp(f.from.cy, f.to.cy, p) - h / 2 - 110 * Math.sin(Math.PI * p);
					const fade = Math.min(prog(t, f.t0, f.t0 + 0.12), 1 - prog(t, f.t1 - 0.18, f.t1));
					carryNode.style.transform = `translate(${x}px, ${y}px) scale(${1 + 0.06 * Math.sin(Math.PI * p)})`;
					carryNode.style.opacity = String(fade);
				}
			}
		},
	};
}

const SHAPES = new Set(['path', 'line', 'polyline', 'polygon', 'circle', 'ellipse', 'rect', 'text', 'image', 'use', 'img', 'canvas', 'video']);
const NOT_DRAWN = new Set(['defs', 'marker', 'clippath', 'mask', 'pattern', 'lineargradient', 'radialgradient', 'filter', 'style', 'script']);
const clear = color => !color || color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color);
/** Whether a box paints something of its own: a fill, a background image, a visible border or a ring. */
function paints(cs) {
	const border = ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(cs[`border${side}Width`]) > 0 && !clear(cs[`border${side}Color`]));
	return !clear(cs.backgroundColor) || cs.backgroundImage !== 'none' || border || (cs.boxShadow && cs.boxShadow !== 'none');
}

/** Scales a beat's body up (never down, at most FILL.max) to fill the room between its heading and the caption band,
 * centred vertically and kept inside the side margins. The body is measured across its whole beat (parts may move or
 * arrive while it plays), once: everything inside keeps its own coordinates and motion, and later measurements (the
 * morph anchors, the lint) see the fitted result. */
function fillBody(entry) {
	const { content, beat } = entry;
	const body = [...content.children].filter(node => node.dataset.head === undefined);
	if (!body.length) {
		return;
	}
	const display = entry.host.style.display;
	entry.host.style.display = 'block';
	let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
	const range = document.createRange();
	const add = (r, origin) => {
		if (r.width >= 1 && r.height >= 1) {
			x0 = Math.min(x0, r.left - origin.left);
			y0 = Math.min(y0, r.top - origin.top);
			x1 = Math.max(x1, r.right - origin.left);
			y1 = Math.max(y1, r.bottom - origin.top);
		}
	};
	// What is drawn, where it is visible now: text by its own extent, SVG shapes, and boxes that paint (a fill, a
	// border, a ring). Invisible parts (a marker parked until its path starts) and empty containers don't count.
	const walk = (n, origin) => {
		const cs = getComputedStyle(n);
		const tag = n.tagName.toLowerCase();
		if (cs.display === 'none' || Number(cs.opacity) < 0.01 || NOT_DRAWN.has(tag)) {
			return;
		}
		if (cs.visibility !== 'hidden') {
			if (SHAPES.has(tag) || paints(cs)) {
				add(n.getBoundingClientRect(), origin);
			}
			for (const c of n.childNodes) {
				if (c.nodeType === 3 && c.textContent.trim()) {
					range.selectNodeContents(c);
					add(range.getBoundingClientRect(), origin);
				}
			}
		}
		for (const c of n.children) {
			walk(c, origin);
		}
	};
	const measure = () => {
		const origin = content.getBoundingClientRect();
		for (const node of body) {
			walk(node, origin);
		}
	};
	// Sampled through the beat, about every 0.4 s: parts may move or arrive while it plays.
	const samples = Math.min(60, Math.max(8, Math.ceil((beat.end - beat.start) / 0.4)));
	for (let i = 0; i <= samples; i++) {
		entry.spec.impl.render(entry.instance, beat.start + ((beat.end - beat.start) * i) / samples, entry.ctx);
		measure();
	}
	entry.host.style.display = display;
	if (!Number.isFinite(x0)) {
		return;
	}
	const w = x1 - x0, h = y1 - y0;
	const k = Math.max(1, Math.min(FILL.max, (FILL.x1 - FILL.x0) / w, (FILL.y1 - FILL.y0) / h));
	// Around its own centre horizontally (a left-aligned body stays left, a centred one centred), then into the margins.
	const left = Math.min(Math.max((x0 + x1) / 2 - (w * k) / 2, FILL.x0), FILL.x1 - w * k);
	const top = Math.max(FILL.y0, (FILL.y0 + FILL.y1) / 2 - (h * k) / 2);
	const tx = left - x0 * k, ty = top - y0 * k;
	if (k === 1 && Math.abs(tx) < 2 && Math.abs(ty) < 2) {
		return;
	}
	const wrap = el('div', 'st-layer', content);
	wrap.dataset.fill = k.toFixed(3);
	wrap.style.transformOrigin = '0 0';
	wrap.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${k.toFixed(4)})`;
	wrap.append(...body);
}
