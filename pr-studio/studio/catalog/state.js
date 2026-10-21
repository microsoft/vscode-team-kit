// need: state. States and transitions: a lifecycle, a status that moves.
import { defineTreatment } from '../engine/scene.js';
import { C, TONE } from '../theme/tokens.js';
import { connector, el, icon, pill, svgLayer, txt } from '../theme/primitives.js';
import { clamp, enter, lerp, prog, standard } from '../engine/motion.js';
import { label } from '../engine/text.js';
import { columnsX, header, need, spread } from './kit.js';

/** States on a track; a marker moves from state to state as the narration describes each transition. */
export const track = defineTreatment({
	id: 'state.track',
	need: 'state',
	name: 'State track',
	when: 'Something moves through 3-5 states (signed out -> negotiating -> authorized; queued -> running -> done), maybe with a failure state.',
	params: {
		eyebrow: 'label', title: 'label',
		states: '[{ title, sub (about 30 characters: one line), icon, tone, at }]  (3-5, in order)',
		edges: '[{ label }]  (labels of the transitions between consecutive states; optional)',
		marker: '{ text, icon }  (what moves)',
		fail: '{ from: state number, title, sub, tone (red by default; neutral for an end that is not a failure), icon, at }  (optional dead end below a state)',
	},
	demo: () => ({
		eyebrow: label('The lifecycle'), title: label('A download now retries before it fails'),
		states: [{ title: label('Queued'), icon: 'hourglass' }, { title: label('Downloading'), icon: 'download' }, { title: label('Retrying'), icon: 'repeat', tone: 'orange' }, { title: label('Installed'), icon: 'check', tone: 'green' }],
		edges: [{ label: label('start') }, { label: label('network error') }, { label: label('second try works') }],
		marker: { text: label('extension.vsix'), icon: 'box' },
	}),
	mount(root, p, ctx) {
		const h = header(root, p, ctx);
		const states = p.states ?? [];
		need(states.length >= 2 && states.length <= 5, 'state.track: 2-5 states');
		const xs = columnsX(states.length, 260, 1660);
		const Y = p.fail ? 520 : 580;
		const svg = svgLayer(root);
		const base = connector(svg, [[xs[0], Y], [xs.at(-1), Y]], { color: C.track, width: 8, head: false, radius: 0 });
		const prog2 = connector(svg, [[xs[0], Y], [xs.at(-1), Y]], { color: C.blue, width: 8, head: false, radius: 0 });
		const nodes = states.map((s, k) => {
			const tone = s.tone ?? 'blue';
			const dot = el('div', 'st-abs', root, { left: xs[k] - 46, top: Y - 46, width: 92, height: 92, borderRadius: 46, background: '#fff', border: `4px solid ${C.lineStrong}`, display: 'grid', placeItems: 'center' });
			const ic = icon(dot, s.icon ?? 'status', 40, C.faint);
			const lab = el('div', 'st-abs', root, { left: xs[k] - 170, width: 340, top: Y + 70, textAlign: 'center' });
			txt(lab, s.title, 'st-h4', { display: 'block', fontSize: 27, whiteSpace: 'nowrap' }, 'div');
			if (s.sub) {
				txt(lab, s.sub, 'st-small', { display: 'block', fontSize: 19, marginTop: 4 }, 'div');
			}
			return { dot, ic, lab, tone };
		});
		const edges = (p.edges ?? []).slice(0, states.length - 1).map((e, k) => (e?.label ? txt(root, e.label, 'st-abs', { left: xs[k] + 50, width: xs[k + 1] - xs[k] - 100, top: Y - 92, textAlign: 'center', fontSize: 20, fontWeight: 600, color: C.body, whiteSpace: 'nowrap' }, 'div') : null));
		const marker = el('div', 'st-carry', root);
		pill(marker, { tone: 'blue', iconName: p.marker?.icon ?? 'box', text: p.marker?.text ?? label('item'), solid: true, size: 'm', style: { boxShadow: '0 8px 22px rgba(0, 95, 184, .22)' } });
		const times = spread(ctx, states, { lead: 0.8, tail: p.fail ? 3 : 1.4 });
		let fail = null;
		if (p.fail) {
			const k = (p.fail.from ?? 2) - 1;
			need(nodes[k], 'fail.from: no such state');
			const tone = p.fail.tone ?? 'red';
			const line = connector(svg, [[xs[k], Y + 160], [xs[k], Y + 214]], { color: TONE[tone]?.fg ?? C.red, width: 3, radius: 0 });
			const box = el('div', 'st-abs', root, { left: Math.max(96, xs[k] - 210), width: 420, top: Y + 224, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 });
			pill(box, { tone, iconName: p.fail.icon ?? (tone === 'red' ? 'dismiss' : 'info'), text: p.fail.title, size: 'l' });
			if (p.fail.sub) {
				txt(box, p.fail.sub, 'st-small', { display: 'block', fontSize: 19, textAlign: 'center' }, 'div');
			}
			fail = { line, box, at: ctx.at(p.fail.at, Math.max(1, ctx.beat.duration - 2.4)) };
		}
		return { h, xs, Y, base, prog2, nodes, edges, marker, times, fail };
	},
	render(i, t, ctx) {
		const s = ctx.beat.start;
		i.h.render(t);
		i.base.render(t, s + 0.4, 0.8);
		let k = -1;
		i.nodes.forEach((n, j) => {
			enter(n.dot, t, s + 0.5 + j * 0.12, { dy: 0, scale: 0.4, dur: 0.5 });
			enter(n.lab, t, s + 0.6 + j * 0.12, { dy: 8 });
			if (t >= i.times[j]) {
				k = j;
			}
		});
		i.edges.forEach((e, j) => {
			if (e) {
				enter(e, t, i.times[j + 1] - 0.4, { dy: 6 });
			}
		});
		i.nodes.forEach((n, j) => {
			const on = j <= k;
			n.dot.style.borderColor = on ? TONE[n.tone].fg : C.lineStrong;
			n.dot.style.background = j === k ? TONE[n.tone].tint : '#fff';
			n.ic.style.color = on ? TONE[n.tone].fg : C.faint;
		});
		// Progress line and marker follow the current state.
		const seg = k < 0 ? 0 : k;
		const from = i.xs[Math.max(0, seg - 1)], to = i.xs[seg];
		const p = k <= 0 ? 1 : standard(prog(t, i.times[k] - 0.45, i.times[k] + 0.25));
		const x = k < 0 ? i.xs[0] : lerp(from, to, p);
		const span = i.xs.at(-1) - i.xs[0];
		i.prog2.path.style.strokeDasharray = `${span}`;
		i.prog2.path.style.strokeDashoffset = `${span - (x - i.xs[0])}`;
		const w = i.marker.offsetWidth, hh = i.marker.offsetHeight;
		i.marker.style.transform = `translate(${x - w / 2}px, ${i.Y - 150 - hh / 2 - 18 * Math.sin(Math.PI * p) * (k > 0 ? 1 : 0)}px)`;
		i.marker.style.opacity = String(clamp(prog(t, i.times[0] - 0.3, i.times[0])));
		if (i.fail) {
			i.fail.line.render(t, i.fail.at, 0.35);
			enter(i.fail.box, t, i.fail.at + 0.25, { dy: 10 });
		}
	},
});
