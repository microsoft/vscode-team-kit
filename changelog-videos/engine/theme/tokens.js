// Design tokens of the studio look (white, Microsoft palette). Same values as theme/studio.css.

export const C = {
	ink: '#1b1b1f', body: '#5f6168', muted: '#767a82', faint: '#b9bcc4', line: '#e3e6eb', lineStrong: '#d3d8e0',
	surface: '#f5f6f8', surface2: '#fafbfc', track: '#eef0f3', connector: '#b6c2d3', connectorStrong: '#9aa3b2',
	blue: '#0078d4', blueTint: '#eef4fd', blueBar: '#93b7e8',
	green: '#107c10', greenTint: '#eef7ea',
	red: '#d13438', redTint: '#fbeeed',
	orange: '#d83b01', orangeTint: '#fcf1ec',
	purple: '#8661c5', purpleTint: '#f3effa',
};

export const TONE = {
	blue: { fg: C.blue, tint: C.blueTint },
	green: { fg: C.green, tint: C.greenTint },
	red: { fg: C.red, tint: C.redTint },
	orange: { fg: C.orange, tint: C.orangeTint },
	purple: { fg: C.purple, tint: C.purpleTint },
	neutral: { fg: C.body, tint: C.surface },
};

/** Step colors for numbered sequences (1, 2, 3, 4, ...). */
export const STEP = [C.blue, C.green, C.purple, C.orange];

export const MS_LOGO = ['#f25022', '#7fba00', '#00a4ef', '#ffb900'];

/** Safe area: content lives in x 96..1824, y 96..930; the caption pill sits at y 970..1046, the progress line at 1074..1080. */
export const SAFE = { x0: 96, x1: 1824, y0: 96, y1: 930 };
/** Region below a slide heading. */
export const CONTENT = { x: 96, y: 236, w: 1728, h: 694 };
/** Where a beat's body is fitted (engine/stage.js): scaled up to at most `max` and centred between the heading and the
 * caption band, with room left above the band for entrance motion. */
export const FILL = { x0: 96, x1: 1824, y0: 236, y1: 904, max: 1.25 };

export function tone(name) {
	const value = TONE[name ?? 'neutral'];
	if (!value) {
		throw new Error(`Unknown tone "${name}" (one of ${Object.keys(TONE).join(', ')})`);
	}
	return value;
}
