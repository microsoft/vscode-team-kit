// The pages of a deck in build order, shared by build.mjs and check-links.mjs so both agree on page numbers.
// - A slide with `clicks` (click-by-click) becomes one page per click: one click = the next PDF page. (Not `steps`:
//   several layouts use that field for their own content.)
// - A poll with an answer adds a reveal page.
// Every page knows its slide number, so the counter in the corner counts slides, not clicks.
export function deckPages(deck) {
	const pages = [];
	let slideNo = 0;
	for (const section of deck.sections) {
		for (const s of section.slides) {
			if (deck.filter && !deck.filter(s, section)) {
				continue;
			}
			slideNo++;
			const steps = s.clicks?.length ?? 0;
			if (steps) {
				for (let k = 1; k <= steps; k++) {
					pages.push({ s, section, slideNo, step: k, steps, first: k === 1, last: k === steps });
				}
			} else {
				pages.push({ s, section, slideNo, step: null, steps: 0, first: true, last: true });
			}
			if (s.layout === 'poll' && s.answer && s.reveal !== false) {
				pages.push({ s, section, slideNo, reveal: true, first: false, last: true });
			}
		}
	}
	return { pages, slides: slideNo };
}
