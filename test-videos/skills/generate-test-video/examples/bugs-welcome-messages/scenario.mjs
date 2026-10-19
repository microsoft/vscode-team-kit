// How to verify 3 fixed bugs of the Agents window's welcome messages (milestone 1.143.0), all fixed by PR #341590
// (merge d6fb69c83c, Oct 14): #339711 (`${name}` placeholders), #339712 (rotation across reloads in append mode) and
// #339714 (no welcome message for an empty `replace` list). Steps from the bugs, the PR and the withdrawn TPI #342066.
//
// Not signed in, no chat requests: the welcome name comes from `sessions.chat.experimental.welcomeName`. The three
// settings are application-scoped (ConfigurationScope.APPLICATION): they apply from the Default profile's settings.json
// (User/settings.json here), which is also what "Preferences: Open Application Settings (JSON)" opens in the Agents
// window. Each bug's setting is written to that file at its cue (the band shows the JSON); the window picks it up live.
import fs from 'node:fs';
import path from 'node:path';

const NAME = 'Test Name';
const WELCOME_MESSAGES = 'sessions.chat.experimental.welcomeMessages';
const REPLACE = { mode: 'replace', phrases: ['Hello ${name}', 'Ready, ${name}?', '${name}, let\'s begin'] };
const APPEND = { mode: 'append', phrases: ['Ready, ${name}?', 'Let\'s ship it'] };
const EMPTY = { mode: 'replace', phrases: [] };
// The built-in phrases with a name (src/vs/sessions/contrib/chat/common/welcomePhrases.ts at the build's commit).
const BUILT_IN = [`What are we building, ${NAME}?`, `What\u2019s the move, ${NAME}?`, `Let\u2019s cook, ${NAME}`, `Time to lock in, ${NAME}`, `Let\u2019s ship something, ${NAME}`];
// The phrases each setting should produce, in rotation order.
const REPLACED = ['Hello Test Name', 'Ready, Test Name?', 'Test Name, let\'s begin'];
const APPENDED = [...BUILT_IN, 'Ready, Test Name?', 'Let\'s ship it'];

const HEADING = '.new-session-welcome-message-title';

async function until(check, what, timeout = 3000, interval = 25) {
	const end = Date.now() + timeout;
	for (;;) {
		const value = await check();
		if (value) {
			return value;
		}
		if (Date.now() > end) {
			throw new Error(`Timed out waiting for ${what}`);
		}
		await new Promise(r => setTimeout(r, interval));
	}
}

/** The welcome message as the app renders it: one per new-session composer. */
function welcome(page) {
	return page.evaluate(() => {
		const all = [...document.querySelectorAll('.new-session-welcome-message')];
		const c = all[0];
		const title = c?.querySelector('.new-session-welcome-message-title');
		const r = c?.getBoundingClientRect();
		return {
			count: all.length,
			hidden: c ? c.hidden : null,
			display: c ? getComputedStyle(c).display : null,
			text: title?.textContent ?? null,
			height: r ? Math.round(r.height) : 0,
			visibleClass: !!c?.closest('.new-chat-widget-content')?.classList.contains('welcome-phrases-visible'),
		};
	}).catch(error => ({ error: String(error?.message ?? error) }));
}

/** Waits until exactly one welcome message shows `text`, visibly; throws with what it saw. */
async function expectWelcome(page, text, what, timeout = 3000) {
	let seen;
	await until(async () => {
		seen = await welcome(page);
		return seen.count === 1 && seen.hidden === false && seen.display !== 'none' && seen.height > 0 && seen.visibleClass && seen.text === text;
	}, `${what}: "${text}"`, timeout).catch(() => {
		throw new Error(`${what}: expected the welcome message "${text}", saw ${JSON.stringify(seen)}`);
	});
	return seen;
}

/** Waits until the welcome message is hidden (no text, not displayed); throws with what it saw. */
async function expectHidden(page, what, timeout = 3000) {
	let seen;
	await until(async () => {
		seen = await welcome(page);
		return seen.count === 1 && seen.hidden === true && seen.display === 'none' && seen.height === 0 && !seen.visibleClass && seen.text === '';
	}, what, timeout).catch(() => {
		throw new Error(`${what}: expected no welcome message, saw ${JSON.stringify(seen)}`);
	});
	return seen;
}

/** A placeholder left in a phrase: `${name}`, `{name}`, or a stray `$` or brace. */
const unresolved = text => /[${}]/.test(text);

/** The Default profile's settings.json: where application-scoped settings apply. */
const settingsFile = ctx => path.join(ctx.paths.data, 'User/settings.json');

/** Sets `sessions.chat.experimental.welcomeMessages` in the Default profile's settings.json, as a tester would. */
function setWelcomeMessages(ctx, value) {
	const file = settingsFile(ctx);
	const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
	settings[WELCOME_MESSAGES] = value;
	fs.writeFileSync(file, JSON.stringify(settings, null, '\t'));
}

/** The pointer's resting place: beside the composer, clear of the heading and the Command Palette. */
const REST = { x: 1380, y: 560 };

/** Redraws the pointer where it rests (a reload removes the drawn pointer). */
async function restPointer(ctx, ms = 1) {
	await ctx.h.glide(REST.x, REST.y, ms);
}

/**
 * The browser synthesizes a mouse move at the real cursor about 0.5 s after the Command Palette or a picker closes,
 * which makes the drawn pointer jump (guide.md: "Native menus and the drawn pointer"). Registered before the kit's pointer overlay (and
 * again after each reload, which removes both), this listener drops such a move once `__tpiFilter` is on: a move far
 * from the last one is kept only when the next move continues from it, as in a fast glide.
 */
async function installMoveFilter(page) {
	await page.evaluate(() => {
		if (window.__tpiMoveFilter) {
			return;
		}
		window.__tpiMoveFilter = true;
		window.__tpiMoves = [];
		let last;
		let pending;
		const near = (a, b) => !!a && Math.hypot(a.x - b.x, a.y - b.y) <= 150;
		window.addEventListener('mousemove', e => {
			const p = { x: e.clientX, y: e.clientY };
			const continues = near(pending, p) && (p.x !== pending.x || p.y !== pending.y);
			const keep = !window.__tpiFilter || !last || near(last, p) || continues;
			pending = keep ? undefined : p;
			window.__tpiMoves.push([Date.now(), p.x, p.y, keep]);
			if (keep) {
				last = p;
			} else {
				e.stopImmediatePropagation();
			}
		}, true);
	});
}

/** Places the pointer at rest with the filter off (a jump), then turns the filter on. */
async function settlePointer(ctx) {
	await installMoveFilter(ctx.page);
	await ctx.page.evaluate(() => { window.__tpiFilter = false; });
	await restPointer(ctx);
	await ctx.page.evaluate(() => { window.__tpiFilter = true; });
}

/** The moves the filter dropped since the page loaded. */
const droppedMoves = page => page.evaluate(() => (window.__tpiMoves ?? []).filter(m => !m[3]).map(m => [m[1], m[2]]));

/** Throws unless the drawn pointer is where the scenario put it (no jump). */
async function expectPointerAt(page, at, what) {
	const drawn = await page.evaluate(() => {
		const root = [...document.body.children].find(e => e.style.zIndex === '2147483647');
		const match = /translate\((?<x>-?[\d.]+)px,\s*(?<y>-?[\d.]+)px\)/.exec(root?.children[0]?.style.transform ?? '');
		return match ? { x: Number(match.groups.x) + 3, y: Number(match.groups.y) + 2 } : null;
	});
	if (!drawn || Math.hypot(drawn.x - at.x, drawn.y - at.y) > 4) {
		throw new Error(`${what}: the drawn pointer is at ${JSON.stringify(drawn)}, not ${JSON.stringify(at)}; dropped moves ${JSON.stringify(await droppedMoves(page))}`);
	}
}

/** The Command Palette's state: open, focus in its input, its value and the picked row. */
function palette(page) {
	return page.evaluate(() => {
		const widget = document.querySelector('.quick-input-widget');
		const input = widget?.querySelector('input');
		const open = !!widget && widget.getBoundingClientRect().height > 0 && getComputedStyle(widget).display !== 'none';
		return {
			open,
			focused: !!input && document.activeElement === input,
			value: open ? input?.value ?? null : null,
			picked: open ? widget.querySelector('.monaco-list-row.focused')?.getAttribute('aria-label') ?? null : null,
		};
	});
}

/**
 * Opens the Command Palette (⇧⌘P in the badge) and types `text`; returns once the picked row is `command` (an exact
 * label, optionally followed by ", recently used"). Types only while the palette's input has focus.
 */
async function paletteTo(ctx, text, command) {
	const { page, h } = ctx;
	await h.press('Meta+Shift+P', '\u21e7\u2318P');
	await until(async () => { const p = await palette(page); return p.open && p.focused && p.value === '>'; }, 'the Command Palette', 2500);
	for (const char of text) {
		if (!(await palette(page)).focused) {
			throw new Error(`Focus left the Command Palette while typing "${text}"`);
		}
		await page.keyboard.type(char);
		await page.waitForTimeout(6);
	}
	const exact = new RegExp(`^${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(, recently used)?$`);
	let p;
	await until(async () => { p = await palette(page); return p.focused && p.value === `>${text}` && exact.test(p.picked ?? ''); }, `"${command}" picked in the palette`, 2500).catch(() => {
		throw new Error(`The palette doesn't pick "${command}": ${JSON.stringify(p)}`);
	});
	return p.picked;
}

/**
 * Developer: Reload Window from the Command Palette, then waits until the reloaded window shows its new-session
 * composer. Returns how long the reload took (ms).
 */
async function reload(ctx, badge) {
	const { page, h } = ctx;
	await paletteTo(ctx, 'Reload Window', 'Developer: Reload Window');
	await page.evaluate(() => { window.__tpiBeforeReload = true; });
	await page.keyboard.press('Enter');
	const t0 = Date.now();
	await until(async () => {
		const state = await page.evaluate(() => ({ old: !!window.__tpiBeforeReload, composer: !!document.querySelector('.new-chat-widget-content .new-session-welcome-message') })).catch(() => ({ old: true }));
		return !state.old && state.composer;
	}, 'the reloaded window', 20000);
	const ms = Date.now() - t0;
	await settlePointer(ctx);
	await h.badge(badge, 1300);
	return ms;
}

export default {
	signedIn: false,
	agents: true,
	settings: {
		'sessions.chat.experimental.welcomePhrases': true,
		'sessions.chat.experimental.welcomeName': NAME,
	},
	steps: [
		{
			id: 'prepare',
			hidden: true,
			async run(ctx) {
				const { page } = ctx;
				// Before anything draws the kit's pointer: the filter for synthesized mouse moves.
				await installMoveFilter(page);
				// A fresh profile starts the rotation at the first built-in phrase.
				await expectWelcome(page, BUILT_IN[0], 'At launch', 30000);
				await page.waitForTimeout(1500);
				await expectWelcome(page, BUILT_IN[0], 'At launch, settled');
				await settlePointer(ctx);
				const settings = JSON.parse(fs.readFileSync(settingsFile(ctx), 'utf8'));
				if (settings['sessions.chat.experimental.welcomePhrases'] !== true || settings['sessions.chat.experimental.welcomeName'] !== NAME || WELCOME_MESSAGES in settings) {
					throw new Error(`Unexpected settings: ${JSON.stringify(settings)}`);
				}
				return `The new-session composer shows "${BUILT_IN[0]}"; welcomePhrases and welcomeName set in the Default profile's settings.json, no welcomeMessages.`;
			}
		},
		{
			id: 'setup',
			async run(ctx) {
				const { page } = ctx;
				await ctx.look(page.locator(HEADING));
				const shown = await expectWelcome(page, BUILT_IN[0], 'Setup');
				// Where application-scoped settings go: shown in the palette, not run (the settings are already set).
				await ctx.at(ctx.cue('application') - 0.75);
				const picked = await paletteTo(ctx, 'Open Application Settings', 'Preferences: Open Application Settings (JSON)');
				const row = page.locator('.quick-input-widget .monaco-list-row.focused');
				await ctx.look(row);
				const rowAt = Date.now();
				await ctx.at(Math.max((ctx.take?.seconds ?? 0) + 0.45, (rowAt - ctx.t0) / 1000 + 1.6));
				await page.keyboard.press('Escape');
				await until(async () => !(await palette(page)).open, 'the palette to close', 2000);
				return `Welcome message "${shown.text}" (the configured name in a built-in phrase); the Command Palette picks "${picked}" (shown, not run).`;
			}
		},
		{
			id: 'b1',
			async run(ctx) {
				const { page, h } = ctx;
				const seen = [];
				await ctx.at(0.45);
				setWelcomeMessages(ctx, REPLACE);
				seen.push((await expectWelcome(page, REPLACED[0], '#339711, replace mode')).text);
				await ctx.look(page.locator(HEADING));
				for (const [i, at] of [[1, ctx.cue('Each') - 0.05], [2, ctx.cue('with')]]) {
					await ctx.at(at);
					await h.press('Meta+N');
					seen.push((await expectWelcome(page, REPLACED[i], `#339711, New Session \u00d7${i}`)).text);
					await ctx.look(page.locator(HEADING));
				}
				await ctx.hold(0.6);
				if (seen.some(unresolved)) {
					throw new Error(`A placeholder or stray $ is left: ${JSON.stringify(seen)}`);
				}
				await expectPointerAt(page, REST, '#339711');
				return `${JSON.stringify(REPLACE.phrases)} in replace mode: ${seen.map(s => `"${s}"`).join(', then (\u2318N) ')}; no $, { or } left. Synthesized pointer moves dropped so far: ${JSON.stringify(await droppedMoves(page))}.`;
			}
		},
		{
			id: 'b1desc',
			async run(ctx) {
				const { page, h } = ctx;
				// The pencil beside the heading shows on hover: Customize Welcome Message... → Phrases opens the setting.
				const heading = page.locator(HEADING);
				await h.hover(heading, { ms: 280, fx: 0.7 });
				const pencil = page.locator('.new-session-welcome-message-actions .action-label').first();
				await until(async () => (await pencil.evaluate(e => getComputedStyle(e.closest('.new-session-welcome-message-actions')).opacity)) === '1', 'the pencil', 2000);
				const label = await pencil.getAttribute('aria-label');
				if (label !== 'Customize Welcome Message...') {
					throw new Error(`The pencil is "${label}"`);
				}
				await ctx.look(await h.hover(pencil, { ms: 250 }));
				// The picker (Name, Phrases) stays up at least 1.3 s, the zoom on it, before Phrases is picked.
				await ctx.at(ctx.cue('heading') - 0.1);
				await h.click();
				const option = page.getByRole('option', { name: /^Phrases/ });
				await option.waitFor({ timeout: 3000 });
				const pickerAt = Date.now();
				const options = await page.getByRole('option').evaluateAll(all => all.map(o => o.getAttribute('aria-label')));
				const first = await h.box(page.getByRole('option').first());
				const o = await h.box(option);
				await ctx.look({ x: first.x, y: first.y, width: 200, height: o.y + o.height - first.y });
				await ctx.at(ctx.cue('choose'));
				await h.glide(o.x + 60, o.y + o.height / 2, 260);
				await ctx.look({ x: o.x, y: o.y, width: 200, height: o.height });
				await ctx.at(Math.max(ctx.cue('Phrases') + 0.3, (pickerAt - ctx.t0) / 1000 + 1.3));
				if (!await option.isVisible()) {
					throw new Error('The picker closed before Phrases was picked');
				}
				const pickerHeld = (Date.now() - pickerAt) / 1000;
				if (pickerHeld < 1.25) {
					throw new Error(`The picker was up only ${pickerHeld.toFixed(2)} s`);
				}
				await h.click();
				const item = page.locator('.settings-editor .setting-item').filter({ hasText: 'Welcome Messages' }).first();
				const code = item.locator('.setting-item-description code').filter({ hasText: '${name}' }).first();
				await code.waitFor({ timeout: 5000 });
				await page.waitForTimeout(150);
				const d = await item.evaluate(s => ({
					search: document.querySelector('.settings-editor .suggest-input-container .view-lines')?.textContent,
					label: s.querySelector('.setting-item-label')?.textContent,
					description: s.querySelector('.setting-item-description')?.textContent,
					codes: [...s.querySelectorAll('.setting-item-description code')].map(c => c.textContent),
					allProfiles: (s.textContent ?? '').includes('Applies to all profiles'),
					modal: !!s.closest('.modal-editor-part'),
				}));
				if (d.search !== WELCOME_MESSAGES || !d.codes.includes('${name}') || /(^|[^$])\{name\}/.test(d.description ?? '') || !d.allProfiles) {
					throw new Error(`Unexpected setting description: ${JSON.stringify(d)}`);
				}
				const box = await h.box(code);
				await ctx.look(box);
				await h.glide(box.x + box.width + 260, box.y + 150, 300);
				const shownAt = (Date.now() - ctx.t0) / 1000;
				await ctx.at(Math.max((ctx.take?.seconds ?? 0) + 0.3, shownAt + 1.6));
				await page.keyboard.press('Escape');
				await until(async () => !(await page.locator('.modal-editor-part').first().isVisible().catch(() => false)), 'the Settings editor to close', 3000);
				await expectWelcome(page, REPLACED[2], 'After closing the Settings editor');
				await restPointer(ctx, 250);
				return `Pencil "${label}" \u2192 ${JSON.stringify(options)} (the picker up ${pickerHeld.toFixed(1)} s) \u2192 Phrases: the Settings editor (${d.modal ? 'modal' : 'not modal'}) searches "${d.search}"; "${d.label}" (Applies to all profiles): "${d.description}"`;
			}
		},
		{
			id: 'b2',
			async run(ctx) {
				const { page } = ctx;
				// The rotation index is 2 here: launch (0), then New Session twice in #339711.
				let index = 2;
				await ctx.at(0.6);
				setWelcomeMessages(ctx, APPEND);
				const seen = [(await expectWelcome(page, APPENDED[index], '#339712, append mode')).text];
				let shownAt = (Date.now() - ctx.t0) / 1000;
				await ctx.look(page.locator(HEADING));
				const reloads = [];
				// Each phrase stays up, uncovered, at least 1.4 s before the Command Palette opens for the next reload.
				const held = [];
				for (const [n, planned] of [[1, 2.0], [2, 3.8], [3, ctx.cue('then', 1) - 0.5], [4, 7.85]]) {
					await ctx.at(Math.max(planned, shownAt + 1.4));
					held.push((Date.now() - ctx.t0) / 1000 - shownAt);
					reloads.push(await reload(ctx, `Reloaded \u00d7${n}`));
					index++;
					seen.push((await expectWelcome(page, APPENDED[index % APPENDED.length], `#339712, reload ${n}`)).text);
					shownAt = (Date.now() - ctx.t0) / 1000;
					await ctx.look(page.locator(HEADING));
				}
				await ctx.at(Math.max((ctx.take?.seconds ?? 0) + 0.25, shownAt + 1.5));
				held.push((Date.now() - ctx.t0) / 1000 - shownAt);
				if (Math.min(...held) < 1.35) {
					throw new Error(`A phrase was up only ${Math.min(...held).toFixed(2)} s: ${JSON.stringify(held)}`);
				}
				const custom = seen.filter(s => APPEND.phrases.map(p => p.replace('${name}', NAME)).includes(s));
				if (new Set(seen).size !== seen.length || custom.length !== 2) {
					throw new Error(`Expected a different phrase on each reload, both custom ones among them: ${JSON.stringify(seen)}`);
				}
				await expectPointerAt(page, REST, '#339712');
				return `Append mode: "${seen[0]}"; after each reload (${reloads.map(ms => `${ms} ms`).join(', ')}): ${seen.slice(1).map(s => `"${s}"`).join(' \u2192 ')}. Each phrase up, before the next palette or the step's end: ${held.map(s => `${s.toFixed(2)} s`).join(', ')}.`;
			}
		},
		{
			id: 'b3',
			async run(ctx) {
				const { page, h } = ctx;
				const before = await h.box(page.locator(HEADING));
				const composer = page.locator('.new-chat-widget-content .monaco-editor').first();
				const composerBefore = await h.box(composer);
				await ctx.at(ctx.cue('empty') - 0.35);
				setWelcomeMessages(ctx, EMPTY);
				const hidden = await expectHidden(page, '#339714, replace mode with an empty list');
				const composerAfter = await h.box(composer);
				ctx.mark('layout', { before: composerBefore, after: composerAfter });
				await ctx.look(before);
				await ctx.at(ctx.cue('stays') - 0.2);
				const ms = await reload(ctx, 'Reloaded');
				await page.waitForTimeout(250);
				const afterReload = await expectHidden(page, '#339714, after a reload');
				await ctx.look(before);
				// The composer still takes input.
				await ctx.at(ctx.cue('input') - 0.35);
				const input = page.locator('.new-chat-widget-content .monaco-editor').first();
				const i = await h.hover(input, { ms: 300, fx: 0.25 });
				await ctx.look(i);
				await h.click();
				await until(() => input.evaluate(e => e.contains(document.activeElement)), 'focus in the input', 2000);
				await ctx.at(ctx.cue('works') - 0.1);
				await h.type('Hello', 40);
				const typed = await until(() => input.evaluate(e => e.querySelector('.view-lines')?.textContent?.includes('Hello') && e.querySelector('.view-lines').textContent), 'the typed text', 2000);
				await ctx.hold(0.4);
				await expectHidden(page, '#339714, after typing');
				await expectPointerAt(page, h.cursor, '#339714');
				return `Replace with []: welcome message hidden (${JSON.stringify(hidden)}); composer moved from y=${Math.round(composerBefore.y)} to y=${Math.round(composerAfter.y)}; after a reload (${ms} ms) still hidden (${JSON.stringify(afterReload)}); the input takes "${typed}".`;
			}
		},
		{
			id: 'cleanup',
			async run(ctx) {
				await ctx.hold(0.5);
				await expectPointerAt(ctx.page, ctx.h.cursor, 'Cleanup');
				return `Cleanup band: remove the three settings from Application Settings (JSON). Synthesized pointer moves dropped since the last reload: ${JSON.stringify(await droppedMoves(ctx.page))}.`;
			}
		},
	],
};
