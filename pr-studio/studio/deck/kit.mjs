// Helpers for a deck's own designs (<deck>/designs/*.mjs): the same building blocks the built-in layouts use.
// A design imports them from this file by absolute path: the build gives each design file the path (see designs.mjs).
import fs from 'node:fs';
import { deckFile, htmlRef } from './layouts.mjs';
export { ROOT, deckFile, htmlRef, esc, fmt, plain, ic, iconTile, pill, heading, body, bodyHeight, arrowHead, arrowSvg, stepTone, pngSize, picture, qrSvg } from './layouts.mjs';
export { logo } from './diagrams.mjs';

/** Width of the content area below the heading, in px (the slide is 1920 wide, with 96 px margins). */
export const W = 1728;

/** Rounds a coordinate to one decimal, so the SVG paths stay short. */
export const r1 = v => Math.round(v * 10) / 10;

/** An image of the deck for an <img src>: its path relative to the built HTML, or null if the file is missing (draw a
 * placeholder then). Example: asset('assets/review.png') for <deck>/assets/review.png. */
export function asset(src) {
	const file = deckFile(src);
	return fs.existsSync(file) ? htmlRef(file) : null;
}
