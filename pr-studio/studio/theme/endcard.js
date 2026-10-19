// The end card: where to open the pull request, with a QR code. Same in every video.
import { el, txt, microsoftLogo, card } from './primitives.js';
import { C } from './tokens.js';
import { qrCode } from './qr.js';
import { decel, enter, prog } from '../engine/motion.js';
import { fact, label } from '../engine/text.js';

export function endCard(parent, facts, { headline }) {
	const root = el('div', 'st-endcard', parent);
	root.style.display = 'none';
	const logo = microsoftLogo(root, 96, 82, 32);
	const url = facts.url;
	const eyebrow = txt(root, label('Open the pull request'), 'st-eyebrow st-abs', { left: 96, top: 334 });
	const big = txt(root, url.replace(/^https:\/\//, ''), 'st-mono st-abs', { left: 96, top: 382, fontSize: 46, fontWeight: 600, color: C.blue, whiteSpace: 'nowrap' });
	big.dataset.src = 'fact:url';
	const title = txt(root, headline, 'st-abs', { left: 96, top: 470, width: 1180, fontSize: 36, fontWeight: 600, color: C.ink, lineHeight: 1.2 }, 'div');
	const meta = txt(root, [
		fact('authorLogin', { prefix: '@' }), label('  ·  head '), fact('headSha9'), label('  ·  '), fact('commitCount'),
		label(facts.commitCount === 1 ? ' commit' : ' commits'), label('  ·  '), fact('state', { format: 'lower' }), label('  ·  as of '), fact('fetchedAt', { format: 'date' }),
	], 'st-abs', { left: 96, top: 0, fontSize: 23, color: C.body, whiteSpace: 'pre' }, 'div');
	const rule = el('div', 'st-abs', root, { left: 96, top: 0, width: 120, height: 5, borderRadius: 3, background: C.blue, transformOrigin: '0 50%' });
	const qrCard = card(root, { left: 1424, top: 290, width: 400, height: 452 });
	qrCode(qrCard, url, { x: 30, y: 28, size: 340 });
	txt(qrCard, label('scan to open'), 'st-abs', { left: 0, right: 0, top: 380, textAlign: 'center', fontSize: 21, color: C.body }, 'div');
	return {
		root,
		layout() {
			// The headline may wrap to two lines; the meta line and rule follow it. Measure while displayed.
			const was = root.style.display;
			root.style.display = 'block';
			const bottom = title.offsetTop + title.offsetHeight;
			meta.style.top = `${bottom + 18}px`;
			rule.style.top = `${bottom + 18 + 48 + 34}px`;
			root.style.display = was;
		},
		render(t, at) {
			root.style.display = t >= at - 0.01 ? 'block' : 'none';
			if (t < at - 0.01) {
				return;
			}
			root.style.opacity = String(decel(prog(t, at, at + 0.5)));
			enter(logo, t, at + 0.1, { dy: 6 });
			enter(eyebrow, t, at + 0.2, { dy: 8 });
			enter(big, t, at + 0.3, { dy: 12 });
			enter(title, t, at + 0.45, { dy: 10 });
			enter(meta, t, at + 0.6, { dy: 8 });
			rule.style.transform = `scaleX(${decel(prog(t, at + 0.6, at + 1.3))})`;
			enter(qrCard, t, at + 0.5, { dy: 16 });
		},
	};
}
