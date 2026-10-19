// The samples deck's own design: how a deck draws a slide no built-in layout can, and how a slide builds up click by
// click. Copy its shape for a design of your own, in decks/<slug>/designs/<anything>.mjs: each design returns the HTML of
// one slide, lives with its deck, and can't change any other deck. The slide says layout: '<design name>' and carries
// the design's own fields beside the usual ones (id, eyebrow, title, notes, sources, link, bg). render may be async.
//
// - Name: <deck or topic>-<concept>, lower case, never a built-in layout's name.
// - Helpers (the argument of designs): heading(s), body(html, { vcenter }), bodyHeight(s) (the height under the title),
//   W (1728, the width), ic(name, size, colour), iconTile(name, { tone, size, round, solid }), pill({ text, tone, icon }),
//   logo(slug, size), fmt (inline markup), esc, plain, r1, arrowHead(x2, y2, x1, y1, colour, width), arrowSvg(width,
//   colour), stepTone(i), qrSvg(text), asset('assets/x.png') (an <img src>, or null if missing), deckFile(src) (its
//   path), pngSize(file) ({ width, height }), and picture(src, { crop, maxW, maxH, maxScale, pins, rings }) -> { html, w, h }:
//   a cropped, scaled picture with pins ({ at, n, tone }) and rings ({ box, n, tone }), as the image layout draws it.
// - CSS: every selector starts with the design's class (.samples-build .sb-card), and inner classes carry its prefix
//   (sb-card, not card: the theme's own classes would style it). Only the CSS of designs a deck uses is included.
// - Colours: var(--blue), --green, --red, --orange, --yellow, --purple and their -tint, --ink, --body, --muted, --line,
//   --connector (arrows), --mono (code font); a t-<tone> class sets --fg and --tint. Nothing outside the theme.
// - Text: data-t on every element with text (SVG <text> too), so the build checks overflow and counts words; data-fit
//   on a box whose text could overflow; nolint on decorative text (axis ticks). Code names go in `backticks` in the
//   slide's data: the build checks them against the PR, then fmt draws them as code (plain as text).
// - Never: blurred box-shadow, text-shadow or filter (PDF viewers draw gray boxes; a sharp ring, box-shadow: 0 0 0 6px
//   var(--fg), is fine), gray fills or outlines.
// - Clicks: clicks: [{ caption, say }] makes one page per click, with the caption in a bar at the bottom. ctx.step is 1
//   on the first click. Draw the whole picture every time and hide what comes later with the class later (it keeps its
//   place); give everything that appears or changes a data-key; mark what is new; 3-6 clicks.
// - A good design is the picture you'd draw on a whiteboard (a gauge, a conveyor belt, a checkpoint, a map), fills
//   the page under the title, and keeps to 25 words.
//
//   samples-build: three cards that appear one per click, each joined to the last by an arrow
export function designs({ fmt, ic, heading, body, bodyHeight, W }) {
	return {
		/** Three cards that appear one per click; the newest has a ring. cards: [{ icon, title (<= 20), text (<= 40), tone }].
		 * The slide has one click per card: clicks: [{ caption, say }]. */
		'samples-build': {
			css: `
.samples-build { position: relative; display: flex; align-items: center; justify-content: space-between; }
.samples-build .sb-card { width: 470px; padding: 40px 40px 44px; border-radius: 28px; background: var(--tint); color: var(--fg); }
.samples-build .sb-card .t { margin-top: 24px; font-size: 40px; font-weight: 700; letter-spacing: -.01em; color: var(--ink); }
.samples-build .sb-card .s { margin-top: 10px; font-size: 28px; line-height: 1.3; color: var(--body); }
.samples-build .sb-card.now { box-shadow: 0 0 0 6px var(--fg); }
.samples-build .sb-arrow { color: var(--connector); }
`,
			render(s, ctx) {
				// Without steps the slide shows its last state.
				const step = ctx.step ?? s.cards.length;
				const parts = s.cards.map((c, i) => {
					const shown = i < step;
					const card = `<div class="sb-card t-${c.tone ?? 'blue'}${i === step - 1 ? ' now' : ''}${shown ? '' : ' later'}" data-key="card-${i}" data-fit>${ic(c.icon, 60)}<div class="t" data-t>${fmt(c.title)}</div><div class="s" data-t>${fmt(c.text)}</div></div>`;
					const arrow = i ? `<div class="sb-arrow${shown ? '' : ' later'}" data-key="arrow-${i}">${ic('arrowRight', 64)}</div>` : '';
					return arrow + card;
				}).join('');
				return heading(s) + body(`<div class="samples-build" style="width:${W}px;height:${bodyHeight(s)}px">${parts}</div>`);
			},
		},
	};
}
