// Diagram layouts (v5): shapes that carry the idea, so the slide needs few words. Same look, tones and checks as
// layouts.mjs: every text block carries data-t, every box that could overflow carries data-fit.
import fs from 'node:fs';
import path from 'node:path';
import { LOGOS } from './theme/logos/logos.mjs';
import { ROOT, deckFile, htmlRef, esc, fmt, ic, iconTile, pill, stepTone, heading, body, bodyHeight, arrowHead, arrowSvg, pngSize } from './layouts.mjs';

const W = 1728;
const r1 = v => Math.round(v * 10) / 10;

const logoCache = new Map();
/** A brand mark from deck/theme/logos (Simple Icons), in its brand colour unless a colour is given. */
export function logo(slug, size = 48, color = null) {
	const meta = LOGOS[slug];
	if (!meta) {
		throw new Error(`Unknown logo "${slug}". Known logos: ${Object.keys(LOGOS).join(', ')}`);
	}
	if (!logoCache.has(slug)) {
		logoCache.set(slug, fs.readFileSync(path.join(ROOT, 'deck', 'theme', 'logos', `${slug}.svg`), 'utf8').replace(/<title>[^<]*<\/title>/, ''));
	}
	return `<span class="logo" style="width:${size}px;height:${size}px">${logoCache.get(slug).replace('<svg ', `<svg fill="${color ?? meta.hex}" `)}</span>`;
}

function notesList(callouts) {
	return callouts?.length ? `<div class="ui-notes">${callouts.map((nt, k) => `<div class="unote t-${nt.tone ?? stepTone(k)}"><span class="st-badge" style="width:40px;height:40px;font-size:18px;background:var(--fg)" data-t>${k + 1}</span><div><div class="t" data-t>${fmt(nt.title)}</div>${nt.text ? `<div class="s" data-t>${fmt(nt.text)}</div>` : ''}</div></div>`).join('')}</div>` : '';
}

export const DIAGRAMS = {

	/** A conversation. messages: [{ from: 'user'|'agent'|'note', text, label, mono, icon, tone }], dark: true for a dark
	 * editor panel, width, callouts (<= 3, numbered on the right). */
	chat(s) {
		const width = s.width ?? (s.callouts?.length ? 1040 : 1240);
		const msgs = s.messages.map(m => {
			if (m.from === 'note') {
				return `<div class="chat-note" data-t>${fmt(m.text)}</div>`;
			}
			const user = m.from === 'user';
			const label = m.label ? `<div class="chat-label" data-t>${fmt(m.label)}</div>` : '';
			const avatar = user ? `<span class="chat-av">${ic('person', 28)}</span>` : iconTile(m.icon ?? 'bot', { tone: m.tone ?? 'purple', size: 52, round: true });
			const bubble = `<div class="chat-bubble${m.mono ? ' mono' : ''}" data-fit>${label}<div class="chat-text" data-t>${m.mono ? esc(m.text) : fmt(m.text)}</div></div>`;
			return `<div class="chat-row ${user ? 'user' : 'agent'}">${user ? bubble + avatar : avatar + bubble}</div>`;
		}).join('');
		const panel = `<div class="chat${s.dark ? ' dark' : ''}" style="width:${width}px">${s.window ? `<div class="chat-bar" data-t>${esc(s.window)}</div>` : ''}<div class="chat-msgs">${msgs}</div></div>`;
		return heading(s) + body(`<div class="ui-wrap${s.callouts?.length ? '' : ' center'}">${panel}${notesList(s.callouts)}</div>`);
	},

	/** A folder tree, with highlighted files explained on the right.
	 * root: folder name, items: [{ path: 'a/b/FILE.md' (end folders with /), title, text, icon, tone }] (an item
	 * without a title is drawn but not explained). */
	files(s) {
		const H = bodyHeight(s);
		const rows = [{ name: s.root ?? 'my-app', depth: 0, folder: true }];
		const seen = new Set();
		for (const it of s.items) {
			const isFolder = it.path.endsWith('/');
			const parts = it.path.replace(/\/$/, '').split('/');
			let acc = '';
			parts.forEach((p, i) => {
				acc += (acc ? '/' : '') + p;
				const last = i === parts.length - 1;
				if (!last || isFolder) {
					if (!seen.has(acc)) {
						seen.add(acc);
						rows.push({ name: p, depth: i + 1, folder: true, item: last ? it : null });
					}
				} else {
					rows.push({ name: p, depth: i + 1, folder: false, item: it });
				}
			});
		}
		const panelW = s.panelWidth ?? 640;
		const barH = 58;
		const rowH = Math.min(56, (H - barH - 28) / rows.length);
		const panelH = barH + rows.length * rowH + 20;
		const panelTop = (H - panelH) / 2;
		const explained = [];
		let k = 0;
		const rowHtml = rows.map((r, i) => {
			const it = r.item;
			const tone = it?.tone ?? (it?.title ? stepTone(k) : null);
			const y = panelTop + barH + i * rowH + rowH / 2;
			let badge = '';
			if (it?.title) {
				explained.push({ it, tone, y, k });
				badge = `<span class="st-badge" style="width:30px;height:30px;font-size:15px;background:var(--fg);margin-left:auto" data-t>${k + 1}</span>`;
				k++;
			}
			return `<div class="fx-row${tone ? ` on t-${tone}` : ''}${it?.dim ? ' dim' : ''}" style="height:${r1(rowH)}px;padding-left:${18 + r.depth * 30}px">${ic(r.folder ? 'folder' : 'document', 26, tone ? 'var(--fg)' : 'var(--muted)')}<span class="fx-name" data-t>${esc(r.name)}${r.folder ? '/' : ''}</span>${badge}</div>`;
		}).join('');
		const panel = `<div class="fx-panel" style="left:0;top:${r1(panelTop)}px;width:${panelW}px;height:${r1(panelH)}px"><div class="fx-bar" style="height:${barH}px"><span class="lbl" data-t>Explorer</span></div>${rowHtml}</div>`;
		// Notes on the right, near their row, pushed apart so they never overlap.
		const noteX = panelW + 120;
		const noteH = s.noteHeight ?? 128;
		const gap = 22;
		const ys = explained.map(e => e.y - noteH / 2);
		for (let i = 1; i < ys.length; i++) {
			ys[i] = Math.max(ys[i], ys[i - 1] + noteH + gap);
		}
		const overflow = ys.length ? ys[ys.length - 1] + noteH - H : 0;
		if (overflow > 0) {
			for (let i = ys.length - 1; i >= 0; i--) {
				ys[i] -= overflow;
				if (i > 0) {
					ys[i - 1] = Math.min(ys[i - 1], ys[i] - noteH - gap);
				}
			}
		}
		let svg = '';
		let notes = '';
		explained.forEach((e, i) => {
			const ny = Math.max(0, ys[i]);
			const cy = ny + noteH / 2;
			svg += `<path d="M ${panelW + 6} ${r1(e.y)} C ${panelW + 66} ${r1(e.y)}, ${noteX - 66} ${r1(cy)}, ${noteX - 8} ${r1(cy)}" fill="none" stroke="var(--${e.tone})" stroke-width="3" stroke-linecap="round"/><circle cx="${panelW + 6}" cy="${r1(e.y)}" r="6" fill="var(--${e.tone})"/>`;
			notes += `<div class="fx-note t-${e.tone}" data-fit style="left:${noteX}px;top:${r1(ny)}px;width:${W - noteX}px;height:${noteH}px">${iconTile(e.it.icon ?? 'document', { tone: e.tone, size: 60 })}<div><div class="t" data-t>${fmt(e.it.title)}</div>${e.it.text ? `<div class="s" data-t>${fmt(e.it.text)}</div>` : ''}</div></div>`;
		});
		return heading(s) + body(`<div class="files" style="height:${H}px"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;left:0;top:0">${svg}</svg>${panel}${notes}</div>`, { vcenter: false });
	},

	/** Boxes and arrows on a grid, with yes/no branches. nodes: [{ id, col, row, title, sub, icon, tone, kind: 'decision' }],
	 * edges: [{ from, to, label, bend: 'below'|'above', tone, dashed }], cols, rows, boxWidth, boxHeight. */
	flow(s) {
		const H = bodyHeight(s);
		const C = s.cols ?? Math.max(...s.nodes.map(nd => nd.col)) + 1;
		const R = s.rows ?? Math.max(...s.nodes.map(nd => nd.row)) + 1;
		const cw = W / C, rh = H / R;
		const bw = Math.min(s.boxWidth ?? 390, cw - 64);
		const bh = s.boxHeight ?? (R >= 3 ? 150 : 170);
		const pos = new Map(s.nodes.map(nd => [nd.id, { x: (nd.col + 0.5) * cw, y: (nd.row + 0.5) * rh }]));
		const clip = (c, tx, ty, pad) => {
			const dx = tx - c.x, dy = ty - c.y;
			const kx = dx === 0 ? Infinity : (bw / 2 + pad) / Math.abs(dx);
			const ky = dy === 0 ? Infinity : (bh / 2 + pad) / Math.abs(dy);
			const k = Math.min(kx, ky);
			return { x: c.x + dx * k, y: c.y + dy * k };
		};
		let svg = '';
		let html = '';
		for (const e of s.edges) {
			const a = pos.get(e.from), b = pos.get(e.to);
			if (!a || !b) {
				throw new Error(`flow: unknown node in edge ${e.from} -> ${e.to}`);
			}
			const color = `var(--${e.tone ?? 'connector'})`;
			const dash = e.dashed ? ' stroke-dasharray="8 10"' : '';
			let mid;
			if (e.bend) {
				const amount = e.bendAmount ?? rh * 0.55;
				const off = { below: [0, amount], above: [0, -amount], left: [-amount, 0], right: [amount, 0] }[e.bend];
				const c = { x: (a.x + b.x) / 2 + off[0], y: Math.min(H - 8, Math.max(8, (a.y + b.y) / 2 + off[1])) };
				const p0 = clip(a, c.x, c.y, 6), p1 = clip(b, c.x, c.y, 14);
				svg += `<path d="M ${r1(p0.x)} ${r1(p0.y)} Q ${r1(c.x)} ${r1(c.y)} ${r1(p1.x)} ${r1(p1.y)}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round"${dash}/>${arrowHead(p1.x, p1.y, c.x, c.y, color, 3.5)}`;
				mid = { x: 0.25 * p0.x + 0.5 * c.x + 0.25 * p1.x, y: 0.25 * p0.y + 0.5 * c.y + 0.25 * p1.y };
			} else {
				const p0 = clip(a, b.x, b.y, 6), p1 = clip(b, a.x, a.y, 14);
				svg += `<path d="M ${r1(p0.x)} ${r1(p0.y)} L ${r1(p1.x)} ${r1(p1.y)}" fill="none" stroke="${color}" stroke-width="3.5" stroke-linecap="round"${dash}/>${arrowHead(p1.x, p1.y, p0.x, p0.y, color, 3.5)}`;
				mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
			}
			if (e.label) {
				html += `<div class="flow-label${e.tone ? ` t-${e.tone}` : ''}" data-t style="left:${r1(mid.x)}px;top:${r1(mid.y)}px">${fmt(e.label)}</div>`;
			}
		}
		for (const nd of s.nodes) {
			const p = pos.get(nd.id);
			const tone = nd.tone ?? (nd.kind === 'decision' ? 'orange' : 'blue');
			html += `<div class="flow-node t-${tone}${nd.kind === 'decision' ? ' decision' : ''}${nd.on ? ' on' : ''}" data-fit style="left:${r1(p.x - bw / 2)}px;top:${r1(p.y - bh / 2)}px;width:${r1(bw)}px;height:${bh}px">${iconTile(nd.icon ?? (nd.kind === 'decision' ? 'question' : 'circle'), { tone, size: 52, round: nd.kind === 'decision' })}<div><div class="t" data-t>${fmt(nd.title)}</div>${nd.sub ? `<div class="s" data-t>${fmt(nd.sub)}</div>` : ''}</div></div>`;
		}
		return heading(s) + body(`<div class="flow" style="height:${H}px"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;left:0;top:0;overflow:visible">${svg}</svg>${html}</div>`, { vcenter: false });
	},

	/** A bar chart. bars: [{ label, value, text, tone, on }], unit, max, horizontal: true for long labels, note. */
	bars(s) {
		const H = bodyHeight(s) - (s.note ? 64 : 0);
		const n = s.bars.length;
		const max = s.max ?? Math.max(...s.bars.map(b => b.value));
		const valueText = b => b.text ?? `${b.value}${s.unit ?? ''}`;
		let html = '';
		if (s.horizontal) {
			const rowH = Math.min(96, H / n);
			const labelW = s.labelWidth ?? 440, valueW = 170;
			const trackW = W - labelW - valueW - 48;
			const top = (H - rowH * n) / 2;
			s.bars.forEach((b, i) => {
				const tone = b.tone ?? (b.on ? 'blue' : null);
				const y = top + i * rowH;
				const bw = Math.max(6, (b.value / max) * trackW);
				html += `<div class="bar-hlabel" data-t style="top:${r1(y)}px;height:${r1(rowH)}px;width:${labelW}px">${fmt(b.label)}</div>`;
				html += `<div class="bar-h${tone ? ` on t-${tone}` : ''}" style="left:${labelW + 24}px;top:${r1(y + rowH * 0.2)}px;width:${r1(bw)}px;height:${r1(rowH * 0.6)}px"></div>`;
				html += `<div class="bar-hvalue${tone ? ` t-${tone}` : ''}" data-t style="left:${r1(labelW + 24 + bw + 18)}px;top:${r1(y)}px;height:${r1(rowH)}px">${fmt(valueText(b))}</div>`;
			});
		} else {
			const labelH = 76, valueH = 64;
			const chartH = H - labelH - valueH;
			const slot = W / n;
			const bw = Math.min(s.barWidth ?? 156, slot * 0.62);
			s.bars.forEach((b, i) => {
				const tone = b.tone ?? (b.on ? 'blue' : null);
				const h = Math.max(4, (b.value / max) * chartH);
				const x = i * slot + (slot - bw) / 2;
				const y = valueH + chartH - h;
				html += `<div class="bar-v${tone ? ` on t-${tone}` : ''}" style="left:${r1(x)}px;top:${r1(y)}px;width:${r1(bw)}px;height:${r1(h)}px"></div>`;
				html += `<div class="bar-value${tone ? ` t-${tone}` : ''}" data-t style="left:${r1(i * slot + slot / 2)}px;top:${r1(y - 56)}px">${fmt(valueText(b))}</div>`;
				html += `<div class="bar-label" data-t style="left:${r1(i * slot + 6)}px;top:${r1(valueH + chartH + 16)}px;width:${r1(slot - 12)}px">${fmt(b.label)}</div>`;
			});
			html += `<div class="bar-base" style="top:${valueH + chartH}px"></div>`;
		}
		return heading(s) + body(`<div class="bars" style="height:${H}px">${html}</div>${s.note ? `<div class="counters-note" data-t>${fmt(s.note)}</div>` : ''}`, { vcenter: false });
	},

	/** One giant number or word, with an optional brand logo. logo: github, githubcopilot or vscode, logoText, icon, value, label,
	 * sub (a pill under it), subTone, tone, align: 'left'. Use bg: 'dark' | 'blue' on the slide for a full-colour page. */
	hero(s) {
		const tone = s.tone ?? 'blue';
		let mark = '';
		if (s.logo) {
			mark = `<div class="hero-logo">${logo(s.logo, s.logoSize ?? 112, s.bg === 'dark' || s.bg === 'blue' ? '#ffffff' : null)}${s.logoText ? `<span class="hero-logo-text" data-t style="color:${s.bg === 'dark' || s.bg === 'blue' ? '#ffffff' : LOGOS[s.logo].hex}">${esc(s.logoText)}</span>` : ''}</div>`;
		} else if (s.icon) {
			mark = `<div class="hero-logo">${iconTile(s.icon, { tone, size: 120 })}</div>`;
		}
		const value = s.value ? `<div class="hero-value t-${tone}" data-t data-autofit="${W}">${fmt(s.value)}</div>` : '';
		const label = s.label ? `<div class="hero-label" data-t>${fmt(s.label)}</div>` : '';
		const sub = s.sub ? `<div class="hero-sub">${pill({ text: s.sub, tone: s.subTone ?? 'red', icon: s.subIcon ?? 'warning', size: 'l', white: s.bg === 'dark' || s.bg === 'blue' })}</div>` : '';
		const inner = `<div class="hero${s.align === 'left' ? ' left' : ''}">${mark}${value}${label}${sub}</div>`;
		if (s.title) {
			return heading(s) + body(inner);
		}
		return body(`${s.eyebrow ? `<div class="st-eyebrow hero-eyebrow" data-t>${fmt(s.eyebrow)}</div>` : ''}${inner}`, { full: true });
	},

	/** What one thing keeps across its life: moments left to right, a row per piece of state, a bar while it holds (a
	 * lifecycle, ownership that ends while identity stays). moments: [{ title (<= 18), sub (<= 24) }] (3-5),
	 * rows: [{ title (<= 20), tone, bars: [{ from, to (moment indexes), text (<= 26), tone, solid }] }] (2-5), labelWidth. */
	spans(s) {
		const H = bodyHeight(s);
		const labelW = s.labelWidth ?? 330;
		const x0 = labelW + 130, x1 = W - 175;
		const n = s.moments.length;
		const mx = i => x0 + (i * (x1 - x0)) / (n - 1);
		const headH = 124;
		const rowH = s.rowHeight ?? Math.min(130, Math.max(96, (H - headH - 20) / s.rows.length));
		const barH = Math.round(rowH * 0.55);
		const total = headH + s.rows.length * rowH;
		const y0 = Math.max(0, Math.round((H - total) / 2));
		const axisY = y0 + headH - 20;
		const bottom = y0 + total;
		let svg = `<path d="M ${r1(mx(0) - 50)} ${axisY} H ${r1(mx(n - 1) + 50)}" stroke="var(--connector)" stroke-width="3" stroke-linecap="round"/>`;
		let html = '';
		s.moments.forEach((m, i) => {
			svg += `<path d="M ${r1(mx(i))} ${axisY} V ${bottom}" stroke="var(--connector)" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round"/>`;
			html += `<div class="sp-moment" style="left:${r1(mx(i))}px;top:${y0}px" data-fit><div class="sp-mt" data-t>${fmt(m.title)}</div>${m.sub ? `<div class="sp-ms" data-t>${fmt(m.sub)}</div>` : ''}</div>`;
			html += `<span class="sp-dot" style="left:${r1(mx(i))}px;top:${axisY}px"></span>`;
		});
		s.rows.forEach((row, r) => {
			const y = y0 + headH + r * rowH;
			html += `<div class="sp-row" style="top:${r1(y)}px;width:${labelW}px;height:${r1(rowH)}px" data-fit><div class="sp-rt" data-t>${fmt(row.title)}</div></div>`;
			for (const b of row.bars ?? []) {
				if (!(b.from >= 0 && b.to < n && b.to > b.from)) {
					throw new Error(`spans: a bar of "${row.title}" runs from ${b.from} to ${b.to}; moments are 0 to ${n - 1}`);
				}
				const left = mx(b.from), right = mx(b.to);
				html += `<div class="sp-bar t-${b.tone ?? row.tone ?? 'blue'}${b.solid ? ' sp-solid' : ''}" style="left:${r1(left)}px;top:${r1(y + (rowH - barH) / 2)}px;width:${r1(right - left)}px;height:${barH}px" data-fit>${b.text ? `<span data-t>${fmt(b.text)}</span>` : ''}</div>`;
			}
		});
		return heading(s) + body(`<div class="spans" style="width:${W}px;height:${H}px"><svg class="sp-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>${html}</div>`, { vcenter: false });
	},

	/** A row of 2-5 big icons with one to three words each. items: [{ icon, title, sub, tone }], arrows: true, note. */
	icons(s) {
		const n = s.items.length;
		const size = s.size ?? (n <= 3 ? 176 : n === 4 ? 156 : 136);
		const items = s.items.map((it, i) => {
			const tone = it.tone ?? stepTone(i);
			const el = `<div class="icons-item t-${tone}"><span class="icons-circle" style="width:${size}px;height:${size}px">${ic(it.icon, Math.round(size * 0.46))}</span><div class="icons-title" data-t>${fmt(it.title)}</div>${it.sub ? `<div class="icons-sub" data-t>${fmt(it.sub)}</div>` : ''}</div>`;
			return i < n - 1 && s.arrows ? `${el}<div class="icons-arrow" style="margin-top:${size / 2 - 12}px">${arrowSvg(64)}</div>` : el;
		}).join('');
		return heading(s) + body(`<div class="icons${s.arrows ? ' arrows' : ''}">${items}</div>${s.note ? `<div class="counters-note icons-note" data-t>${fmt(s.note)}</div>` : ''}`);
	},

	/** Who does what: steps left to right in 2-3 lanes (e.g. People and AI), so you see which steps a person does.
	 * lanes: [{ id, title, icon, tone }], steps: [{ lane (a lane id; null = across all lanes, e.g. the release), icon, title,
	 * sub }], hops: ['', 'label on the line from step 1 to step 2', ...]. */
	lanes(s) {
		const H = bodyHeight(s);
		const L = s.lanes.length;
		const labelW = 230;
		const laneGap = 18;
		const laneH = (H - laneGap * (L - 1)) / L;
		const n = s.steps.length;
		const slot = (W - labelW) / n;
		const dot = 96;
		const laneTop = j => j * (laneH + laneGap);
		const pos = s.steps.map((st, i) => {
			const j = st.lane == null ? -1 : s.lanes.findIndex(l => l.id === st.lane);
			if (st.lane != null && j < 0) {
				throw new Error(`lanes: step "${st.title}" names an unknown lane "${st.lane}" on ${s.id}`);
			}
			const cy = j < 0 ? H / 2 - 24 : laneTop(j) + laneH * 0.42;
			return { x: labelW + slot * i + slot / 2, y: cy, j };
		});
		const bands = s.lanes.map((l, j) => `<div class="ln-band t-${l.tone ?? stepTone(j)}" style="top:${r1(laneTop(j))}px;height:${r1(laneH)}px"><div class="ln-label" style="width:${labelW - 30}px">${ic(l.icon ?? 'person', 40)}<span data-t>${fmt(l.title)}</span></div></div>`).join('');
		let svg = '';
		pos.forEach((p, i) => {
			if (i === 0) {
				return;
			}
			const a = pos[i - 1];
			const x1 = a.x + dot / 2 + 10, x2 = p.x - dot / 2 - 14;
			let d;
			if (Math.abs(a.y - p.y) < 1) {
				d = `M ${r1(x1)} ${r1(a.y)} L ${r1(x2)} ${r1(p.y)}`;
			} else {
				// Change lanes between the two columns, where there is no text: right, down (or up), right.
				const xm = (a.x + p.x) / 2;
				const r = 26 * Math.sign(p.y - a.y);
				d = `M ${r1(x1)} ${r1(a.y)} H ${r1(xm - 26)} Q ${r1(xm)} ${r1(a.y)} ${r1(xm)} ${r1(a.y + r)} V ${r1(p.y - r)} Q ${r1(xm)} ${r1(p.y)} ${r1(xm + 26)} ${r1(p.y)} H ${r1(x2)}`;
			}
			svg += `<path d="${d}" fill="none" stroke="var(--connector)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>${arrowHead(x2, p.y, x2 - 30, p.y, 'var(--connector)', 4)}`;
		});
		const hops = (s.hops ?? []).map((h, i) => {
			if (!h || !pos[i + 1]) {
				return '';
			}
			const a = pos[i], b = pos[i + 1];
			return `<div class="ln-hop" style="left:${r1((a.x + b.x) / 2)}px;top:${r1((a.y + b.y) / 2 - 46)}px" data-t>${fmt(h)}</div>`;
		}).join('');
		const steps = s.steps.map((st, i) => {
			const p = pos[i];
			const tone = p.j < 0 ? (st.tone ?? 'blue') : (st.tone ?? s.lanes[p.j].tone ?? stepTone(p.j));
			return `<div class="ln-step t-${tone}${p.j < 0 ? ' across' : ''}" style="left:${r1(p.x - slot / 2 + 8)}px;top:${r1(p.y - dot / 2)}px;width:${r1(slot - 16)}px"><span class="ln-dot" style="width:${dot}px;height:${dot}px">${ic(st.icon ?? 'circle', 44)}</span><div class="ln-title" data-t>${fmt(st.title)}</div>${st.sub ? `<div class="ln-sub" data-t>${fmt(st.sub)}</div>` : ''}</div>`;
		}).join('');
		return heading(s) + body(`<div class="lanes" style="height:${H}px">${bands}<svg class="rd-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${svg}</svg>${hops}${steps}</div>`, { vcenter: false });
	},

	/** How to do it in an app, step by step, with the real keys and screens drawn small (for people new to the app).
	 * steps (2-5): [{ title (<= 24), sub (<= 28), ui }], where ui is one of:
	 *   { keys: ['F1'], alts: [{ label: 'Mac', keys: ['⇧', '⌘', 'P'] }] }   keycaps
	 *   { palette: 'typed text', items: ['Command title'], pick: 0 }         the command list, one row picked
	 *   { prompt: 'text above the box', input: 'what you paste' }           an input box
	 *   { prompt: 'text above the list', list: ['name', ...], pick: 0 }   a list to pick from
	 * button: { url, label, caption, icon } (a real link in the PDF, e.g. vscode://... to install in one click), note. */
	howto(s) {
		const H = bodyHeight(s);
		const n = s.steps.length;
		const gap = 60;
		const colW = (W - gap * (n - 1)) / n;
		const footH = s.button || s.note ? 96 : 0;
		const uiTop = 104;
		const uiH = Math.min(330, H - footH - uiTop - 12);
		const key = (k, small) => `<span class="ht-key${small ? ' small' : ''}">${esc(k)}</span>`;
		const ui = u => {
			if (u.keys) {
				const alts = (u.alts ?? []).map(a => `<div class="ht-alt"><span class="ht-alt-label">${esc(a.label)}</span>${a.keys.map(k => key(k, true)).join('')}</div>`).join('');
				return `<div class="ht-keys">${u.keys.map(k => key(k)).join('')}</div>${alts ? `<div class="ht-or">or</div>${alts}` : ''}`;
			}
			if (u.palette !== undefined) {
				const rows = (u.items ?? []).map((it, i) => `<div class="ht-row${i === (u.pick ?? 0) ? ' on' : ''}">${esc(it)}</div>`).join('');
				return `<div class="ht-field">&gt; ${esc(u.palette)}<i class="ht-caret"></i></div>${rows}`;
			}
			if (u.input !== undefined) {
				return `${u.prompt ? `<div class="ht-prompt">${esc(u.prompt)}</div>` : ''}<div class="ht-field focus">${esc(u.input)}<i class="ht-caret"></i></div>${u.hint ? `<div class="ht-hint">${esc(u.hint)}</div>` : ''}`;
			}
			if (u.list) {
				const rows = u.list.map((it, i) => `<div class="ht-row${i === (u.pick ?? 0) ? ' on' : ''}">${i === (u.pick ?? 0) ? '<span class="ht-check">\u2713</span>' : ''}${esc(it)}</div>`).join('');
				return `${u.prompt ? `<div class="ht-prompt">${esc(u.prompt)}</div>` : ''}${rows}`;
			}
			return '';
		};
		let arrows = '';
		const cols = s.steps.map((st, i) => {
			const x = i * (colW + gap);
			if (i < n - 1) {
				const ax = x + colW + gap / 2;
				arrows += `<span class="ht-arrow" style="left:${r1(ax - 18)}px;top:${r1(uiTop + uiH / 2 - 18)}px">${ic('arrowRight', 36)}</span>`;
			}
			return `<div class="ht-step t-${st.tone ?? 'blue'}" style="left:${r1(x)}px;width:${r1(colW)}px"><div class="ht-head"><span class="st-badge ht-n" data-t>${i + 1}</span><div><div class="ht-title" data-t>${fmt(st.title)}</div>${st.sub ? `<div class="ht-sub" data-t>${fmt(st.sub)}</div>` : ''}</div></div><div class="ht-ui" style="top:${uiTop}px;height:${r1(uiH)}px">${ui(st.ui ?? {})}</div></div>`;
		}).join('');
		let foot = '';
		if (footH) {
			const b = s.button;
			const button = b ? `<a class="ht-button" href="${esc(b.url)}">${ic(b.icon ?? 'download', 30)}<span data-t>${fmt(b.label)}</span></a>${b.caption ? `<span class="ht-button-cap" data-t>${fmt(b.caption)}</span>` : ''}` : '';
			foot = `<div class="ht-foot" style="top:${r1(H - footH + 22)}px">${button}${s.note ? `<span class="ht-note" data-t>${fmt(s.note)}</span>` : ''}</div>`;
		}
		return heading(s) + body(`<div class="ht" style="height:${H}px">${cols}${arrows}${foot}</div>`, { vcenter: false });
	},

};
