// How to verify #339711 (`${name}` in welcome messages), #339712 (rotation across reloads in append mode) and #339714
// (no message for an empty `replace` list), all fixed by PR #341590. Not signed in. The settings are application-scoped:
// they apply from the Default profile's settings.json, which "Open Application Settings (JSON)" opens. Each bug writes
// its setting there at its cue (the band shows the JSON), and the window picks it up live.
import fs from 'node:fs';
import path from 'node:path';

const NAME = 'Test Name';
const HEADING = '.new-session-welcome-message-title';
// The built-in phrases (welcomePhrases.ts at the build's commit), then what each setting gives, in rotation order.
const BUILT_IN = [`What are we building, ${NAME}?`, `What\u2019s the move, ${NAME}?`, `Let\u2019s cook, ${NAME}`, `Time to lock in, ${NAME}`, `Let\u2019s ship something, ${NAME}`];
const REPLACED = ['Hello Test Name', 'Ready, Test Name?', 'Test Name, let\'s begin'];
const APPENDED = [...BUILT_IN, 'Ready, Test Name?', 'Let\'s ship it'];
/** The pointer's resting place, clear of the heading and the Command Palette. */
const REST = { x: 1380, y: 560 };

const now = ctx => (Date.now() - ctx.t0) / 1000;

/** Polls `fn` until it returns { ok: true, ... }; after `ms`, throws with what it saw. */
async function until(page, what, fn, ms = 3000) {
	for (const end = Date.now() + ms; ;) {
		const seen = await fn();
		if (seen.ok) {
			return seen;
		}
		if (Date.now() > end) {
			throw new Error(`Expected ${what}, got ${JSON.stringify(seen)}`);
		}
		await page.waitForTimeout(25);
	}
}

/** Waits until the one welcome message shows `text`, or (null) is hidden: not displayed, no height, no text. */
const expectWelcome = (page, text, ms) => until(page, text ? `the welcome message "${text}"` : 'no welcome message', () => page.evaluate(t => {
	const all = [...document.querySelectorAll('.new-session-welcome-message')];
	const c = all[0];
	const shown = c ? [!c.hidden, getComputedStyle(c).display !== 'none', c.getBoundingClientRect().height > 0, !!c.closest('.welcome-phrases-visible')] : [];
	const title = c?.querySelector('.new-session-welcome-message-title')?.textContent;
	return { ok: all.length === 1 && (t ? shown.every(Boolean) && title === t : !shown.some(Boolean) && title === ''), count: all.length, shown, title };
}, text).catch(e => ({ error: e.message })), ms);

/** Sets welcomeMessages in the Default profile's settings.json, as a tester would. */
function setMessages(ctx, value) {
	const file = path.join(ctx.paths.data, 'User/settings.json');
	const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
	settings['sessions.chat.experimental.welcomeMessages'] = value;
	fs.writeFileSync(file, JSON.stringify(settings, null, '\t'));
}

/** Developer: Reload Window, from the Command Palette; waits for the new composer, and redraws the pointer at rest. */
async function reload(ctx, badge) {
	const { page, h } = ctx;
	await page.evaluate(() => { window.__old = true; });
	await h.command('Developer: Reload Window', 'Reload Window');
	await until(page, 'the reloaded window', async () => ({ ok: await page.evaluate(() => !window.__old && !!document.querySelector('.new-chat-widget-content .new-session-welcome-message')).catch(() => false) }), 20000);
	await h.glide(REST.x, REST.y, 1);
	await h.badge(badge, 1300);
}

export default {
	signedIn: false,
	agents: true,
	settings: { 'sessions.chat.experimental.welcomePhrases': true, 'sessions.chat.experimental.welcomeName': NAME },
	steps: [
		{
			id: 'prepare', hidden: true, async run(ctx) {
				// A fresh profile starts the rotation at the first built-in phrase, and stays there.
				await expectWelcome(ctx.page, BUILT_IN[0], 30000);
				await ctx.page.waitForTimeout(1500);
				await expectWelcome(ctx.page, BUILT_IN[0]);
				await ctx.h.glide(REST.x, REST.y, 1);
				return `"${BUILT_IN[0]}" at launch.`;
			},
		},
		{
			id: 'setup', async run(ctx) {
				const { page, h } = ctx;
				await ctx.look(page.locator(HEADING));
				// Where application-scoped settings go: shown in the palette, not run (they're already set).
				await ctx.at(ctx.cue('application') - 0.75);
				await h.press('Meta+Shift+P');
				await page.locator('.quick-input-widget input').waitFor({ timeout: 3000 });
				await h.type('Open Application Settings', 12);
				await page.waitForTimeout(250);
				await h.pickRow('Preferences: Open Application Settings (JSON)');
				await ctx.look(page.locator('.quick-input-widget .monaco-list-row.focused'));
				const rowAt = now(ctx);
				await ctx.hold(0.45);
				await ctx.at(rowAt + 1.6);
				await page.keyboard.press('Escape');
				await until(page, 'the palette closed', async () => ({ ok: !(await h.quickInput()).open }));
				return 'The palette picks "Preferences: Open Application Settings (JSON)" (shown, not run).';
			},
		},
		{
			id: 'b1', async run(ctx) {
				const { page, h } = ctx;
				await ctx.at(0.45);
				setMessages(ctx, { mode: 'replace', phrases: ['Hello ${name}', 'Ready, ${name}?', '${name}, let\'s begin'] });
				await expectWelcome(page, REPLACED[0]);
				await ctx.look(page.locator(HEADING));
				for (const [i, at] of [[1, ctx.cue('Each') - 0.05], [2, ctx.cue('with')]]) {
					await ctx.at(at);
					await h.press('Meta+N');
					await expectWelcome(page, REPLACED[i]);
					await ctx.look(page.locator(HEADING));
				}
				await ctx.hold(0.6);
				return `Replace mode: "${REPLACED.join('", then (\u2318N) "')}".`;
			},
		},
		{
			id: 'b2', async run(ctx) {
				const { page } = ctx;
				await ctx.at(0.6);
				setMessages(ctx, { mode: 'append', phrases: ['Ready, ${name}?', 'Let\'s ship it'] });
				// The rotation is at 2 here: the launch, then two new sessions in #339711.
				await expectWelcome(page, APPENDED[2]);
				let shownAt = now(ctx);
				await ctx.look(page.locator(HEADING));
				for (const [n, planned] of [[1, 2.0], [2, 3.8], [3, ctx.cue('then', 1) - 0.5], [4, 7.85]]) {
					// Each phrase stays up, uncovered, at least 1.4 s.
					await ctx.at(Math.max(planned, shownAt + 1.4));
					await reload(ctx, `Reloaded \u00d7${n}`);
					await expectWelcome(page, APPENDED[2 + n]);
					shownAt = now(ctx);
					await ctx.look(page.locator(HEADING));
				}
				await ctx.hold(0.25);
				await ctx.at(shownAt + 1.5);
				return `Append mode, one per reload: "${APPENDED.slice(2).join('" \u2192 "')}".`;
			},
		},
		{
			id: 'b3', async run(ctx) {
				const { page, h } = ctx;
				const before = await h.box(page.locator(HEADING));
				await ctx.at(ctx.cue('empty') - 0.35);
				setMessages(ctx, { mode: 'replace', phrases: [] });
				await expectWelcome(page, null);
				ctx.mark('layout');
				await ctx.look(before);
				await ctx.at(ctx.cue('stays') - 0.2);
				await reload(ctx, 'Reloaded');
				await page.waitForTimeout(250);
				await expectWelcome(page, null);
				await ctx.look(before);
				await ctx.at(ctx.cue('input') - 0.35);
				const input = page.locator('.new-chat-widget-content .monaco-editor').first();
				await ctx.look(await h.hover(input, { ms: 300, fx: 0.25 }));
				await h.click();
				await ctx.at(ctx.cue('works') - 0.1);
				await h.type('Hello', 40);
				await until(page, '"Hello" in the input', async () => ({ ok: (await input.locator('.view-lines').textContent()).includes('Hello') }), 2000);
				await ctx.hold(0.4);
				await expectWelcome(page, null);
				return 'Replace with []: no welcome message, also after a reload; the input takes "Hello".';
			},
		},
		{
			id: 'cleanup', async run(ctx) {
				await ctx.hold(0.5);
				return 'The band lists the three settings to remove.';
			},
		},
	],
};
