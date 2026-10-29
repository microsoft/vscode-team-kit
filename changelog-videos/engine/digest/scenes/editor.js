// An editor with a file open, where text appears at the cursor: pasted, or inserted by a command. What appears is
// the PR's own example (a value of its tests), not text made up for the video.
import { esc, sceneRect, vscodeWindow } from './chrome.js';

const lines = text => String(text ?? '').split('\n');

export default {
	name: 'editor',
	doc: 'An editor with a file open, where text appears at the cursor: pasted, or inserted by a command.',
	params: {
		file: 'the file open in it, e.g. "notes.md" (its tab)',
		lines: 'the lines already in it (optional, up to 8)',
		insert: 'the text that appears (lines joined with \\n): the PR\'s own example, e.g. a value from its tests',
		insertAt: 'time it appears',
	},
	targets: ['editor', 'inserted'],
	windows(p, { start, end }) {
		return { editor: [start, end], inserted: [(p.insertAt ?? start + 1) + 0.05, end] };
	},
	/** Each line that appears is the PR's. */
	proofs: p => {
		const shown = lines(p.insert).filter(l => l.trim());
		return shown.length ? shown.map(l => ({ param: 'insert', text: l })) : [{ param: 'insert', text: undefined }];
	},
	build(host, p, ctx) {
		const { page } = vscodeWindow(host, { tab: p.file ?? 'untitled', tabIcon: 'document' });
		const before = (p.lines ?? []).slice(0, 8);
		const added = lines(p.insert).slice(0, 6);
		const total = before.length + Math.max(1, added.length);
		page.innerHTML = `<div class="ed-code">
			<div class="ed-gutter">${Array.from({ length: total }, (_, i) => `<div class="ed-num${i > before.length ? ' later' : ''}">${i + 1}</div>`).join('')}</div>
			<div class="ed-texts">
				${before.map(l => `<div class="ed-line">${esc(l) || '&nbsp;'}</div>`).join('')}
				<div class="ed-ins">${added.map((l, i) => `<div class="ed-line">${esc(l)}${i === added.length - 1 ? '<span class="ed-caret"></span>' : ''}</div>`).join('')}</div>
				<div class="ed-line ed-empty"><span class="ed-caret"></span></div>
			</div>
		</div>`;
		const code = page.querySelector('.ed-code'), inserted = page.querySelector('.ed-ins'), empty = page.querySelector('.ed-empty');
		const later = [...page.querySelectorAll('.ed-num.later')], carets = [...page.querySelectorAll('.ed-caret')];
		// Measured as laid out with the text in: the ring hugs the lines that appear.
		const rects = { editor: sceneRect(code, host, ctx.view), inserted: sceneRect(inserted, host, ctx.view) };
		const insertAt = p.insertAt ?? ctx.start + 1;
		return {
			rects,
			render(t) {
				const shown = t >= insertAt;
				inserted.style.display = shown ? '' : 'none';
				empty.style.display = shown ? 'none' : '';
				for (const n of later) {
					n.style.visibility = shown ? '' : 'hidden';
				}
				const blink = Math.floor(t * 2) % 2 === 0 ? '1' : '0';
				for (const c of carets) {
					c.style.opacity = blink;
				}
			},
		};
	},
};
