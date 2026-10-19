// How to verify #342051 (Support opening links directly from Quick Open), in the kit's format.
//
// Safety: only `file:` links and `http://127.0.0.1` links (two). The localhost links go to the integrated browser:
// Quick Open calls the shared opener service (`allowContributedOpeners: true`), whose contributed external openers run
// before the system-browser default; Simple Browser's is only an "Option" on desktop, and the integrated browser's
// LocalhostLinkOpenerContribution takes http(s) links to 127.0.0.1 while `workbench.browser.openLocalhostLinks` is
// true (code at eea6efdade and in this build). As a second line of defense, `prepare` replaces Electron's
// shell.openExternal/openPath/showItemInFolder in this throwaway app with a recorder, and every step fails if anything
// tried to leave VS Code.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORK = path.dirname(new URL(import.meta.url).pathname);
const SERVER_LOG = path.join(WORK, 'server.log');
const PAGE = 'http://127.0.0.1:8642/review.html';
const LOCAL = `${PAGE}?pr=342081#changes`;
// The PR's live step 4: another localhost link, also opened with the side button.
const LOCAL2 = `${PAGE}?pr=342081&page=2#files`;
const QI = '.quick-input-widget';
const HINT = 'Hold Alt while accepting to open to the side.';
const INVALID = 'Enter a valid link to open it from Quick Open.';
const SIDE = 'Open to the Side';

const fileLink = (ctx, rel, fragment = '') => pathToFileURL(path.join(ctx.paths.workspace, rel)).href + fragment;
const firstRow = page => page.locator(`${QI} .monaco-list-row`).first();
const quickInput = page => page.locator(`${QI} .quick-input-box input`).first();
const selectionItem = page => page.locator('#status\\.editor\\.selection');
const probing = process.argv.includes('--probe');
/** A screenshot while probing only (it would slow the recording). */
const shot = async (ctx, name) => probing && ctx.shot(name);
/** How many times the test server served the page with this query. */
const pageRequests = (query = 'pr=342081') => fs.readFileSync(SERVER_LOG, 'utf8').split('\n').filter(l => l.includes(`"GET /review.html?${query} `)).length;

/** Polls `fn` (it returns { ok, ...what it saw }) for at most `ms`; returns what it saw, or throws with it. */
async function waitFor(page, what, fn, ms = 4000) {
	const end = Date.now() + ms;
	for (;;) {
		const seen = await fn();
		if (seen.ok) {
			return seen;
		}
		if (Date.now() > end) {
			throw new Error(`Expected ${what}, got ${JSON.stringify(seen)}`);
		}
		await page.waitForTimeout(50);
	}
}

/** The Quick Open rows: label, description, detail line, and button labels. */
const rows = page => page.locator(`${QI} .monaco-list-row`).evaluateAll(all => all.map(r => ({
	label: r.querySelector('.label-name')?.textContent?.trim() ?? '',
	description: r.querySelector('.label-description')?.textContent?.trim() ?? '',
	detail: r.querySelector('.quick-input-list-label-meta')?.textContent?.trim() ?? '',
	buttons: [...r.querySelectorAll('.action-label')].map(b => b.getAttribute('aria-label')),
})));

/** Waits for the one "Open Link" row for `link`, with the Alt hint and the side button. */
function expectLinkRow(page, link) {
	return waitFor(page, `one Open Link row for ${link}`, async () => {
		const all = await rows(page);
		const r = all[0];
		return { ok: all.length === 1 && r.label.endsWith('Open Link') && r.description === link && r.detail === HINT && r.buttons.join() === SIDE, all };
	});
}

/** The editor groups, left to right: active or not, the active tab, the tabs, what the editor shows. */
const groups = page => page.evaluate(() => [...document.querySelectorAll('.editor-group-container')].map(g => {
	const b = g.getBoundingClientRect();
	return {
		active: g.classList.contains('active'),
		locked: g.classList.contains('locked'),
		tab: g.querySelector('.tab.active .label-name')?.textContent?.trim() ?? null,
		tabs: [...g.querySelectorAll('.tab .label-name')].map(t => t.textContent.trim()),
		text: g.querySelector('.monaco-editor .view-lines')?.textContent?.replace(/\u00a0/g, ' ') ?? null,
		box: { x: b.x, y: b.y, width: b.width, height: b.height },
	};
}).filter(g => g.box.width > 0).sort((a, c) => a.box.x - c.box.x));

/** Throws if anything tried to open outside VS Code (the system browser, Finder, another app). */
async function expectNothingOutside(ctx) {
	const blocked = await ctx.app.evaluate(() => globalThis.__tpiBlocked ?? null);
	if (blocked === null) {
		throw new Error('The guard is not installed');
	}
	if (blocked.length) {
		throw new Error(`Something tried to open outside VS Code: ${blocked.join(', ')}`);
	}
}

/** The box of line `n` in the group's editor: its number and the start of its text. */
async function lineBox(page, groupIndex, n) {
	const box = await page.evaluate(([gi, line]) => {
		const g = [...document.querySelectorAll('.editor-group-container')].filter(x => x.getBoundingClientRect().width > 0).sort((a, c) => a.getBoundingClientRect().x - c.getBoundingClientRect().x)[gi];
		const num = [...g.querySelectorAll('.monaco-editor .line-numbers')].find(x => x.textContent.trim() === String(line));
		const b = num?.getBoundingClientRect();
		return b ? { x: b.x - 6, y: b.y - 4, width: 300, height: b.height + 8 } : null;
	}, [groupIndex, n]);
	if (!box) {
		throw new Error(`No line ${n} in group ${groupIndex + 1}`);
	}
	return box;
}

/** Clicks into README.md's text (the left-most group), so its group is the active one, the one Quick Open opens from. */
async function focusReadme(ctx) {
	const { page, h } = ctx;
	const b = await page.evaluate(() => {
		const g = [...document.querySelectorAll('.editor-group-container')].filter(x => x.getBoundingClientRect().width > 0).sort((a, c) => a.getBoundingClientRect().x - c.getBoundingClientRect().x)[0];
		const r = g.querySelector('.monaco-editor .view-lines')?.getBoundingClientRect();
		return r && { x: r.x, y: r.y, width: r.width, height: r.height };
	});
	if (!b) {
		throw new Error('No README.md editor in the first group');
	}
	await h.glide(b.x + Math.min(220, b.width / 2), b.y + 150, 300);
	await h.click();
	await waitFor(page, 'README.md active in group 1', async () => {
		const g = await groups(page);
		return { ok: g[0].active && g[0].tab === 'README.md', g: g.map(x => [x.active, x.tab]) };
	}, 2000);
}

export default {
	signedIn: false,
	agents: false,
	settings: {
		'workbench.browser.openLocalhostLinks': true,
		'workbench.secondarySideBar.defaultVisibility': 'hidden',
		// Dialogs drawn by the workbench, so the recording shows them (a tester sees a native dialog).
		'window.dialogStyle': 'custom',
	},
	workspace: {
		name: 'links-demo',
		files: {
			'README.md': '# Links demo\n\nOpen links straight from Quick Open.\n',
			'src/greet.ts': 'export function greet(name: string) {\n\tconst greeting = \'Hello\';\n\treturn `${greeting}, ${name}!`;\n}\n',
		},
	},
	steps: [
		{
			id: 'prepare',
			hidden: true,
			async run(ctx) {
				const { page, h, app } = ctx;
				await app.evaluate(({ shell }) => {
					globalThis.__tpiBlocked = [];
					for (const name of ['openExternal', 'openPath', 'showItemInFolder']) {
						shell[name] = function (...args) {
							globalThis.__tpiBlocked.push(`${name}(${String(args[0])})`);
							return name === 'showItemInFolder' ? undefined : Promise.resolve(name === 'openPath' ? '' : undefined);
						};
						shell[name].__tpiGuard = true;
					}
				});
				const guarded = await app.evaluate(({ shell }) => ['openExternal', 'openPath', 'showItemInFolder'].filter(n => shell[n].__tpiGuard === true));
				if (guarded.length !== 3) {
					throw new Error(`The guard is not in place: ${JSON.stringify(guarded)}`);
				}
				await page.getByRole('treeitem', { name: 'src' }).click({ timeout: 30000 });
				await page.getByRole('treeitem', { name: 'greet.ts' }).waitFor({ timeout: 5000 });
				// A narrower side bar: room for three editor groups.
				const bar = await h.box(page.locator('#workbench\\.parts\\.sidebar'));
				await page.mouse.move(bar.x + bar.width + 1, 450);
				await page.mouse.down();
				await page.mouse.move(bar.x + 200, 450, { steps: 8 });
				await page.mouse.up();
				await page.waitForTimeout(300);
				await h.quickOpen('README.md');
				await page.mouse.move(900, 600);
				await page.waitForTimeout(1500);
				const g = await groups(page);
				if (g.length !== 1 || g[0].tab !== 'README.md' || !g[0].text?.includes('Links demo')) {
					throw new Error(`Unexpected editors: ${JSON.stringify(g)}`);
				}
				const width = (await h.box(page.locator('#workbench\\.parts\\.sidebar'))).width;
				await expectNothingOutside(ctx);
				return `Guard on (${guarded.join(', ')}); README.md open; side bar ${Math.round(width)} px; src expanded.`;
			}
		},
		{
			id: 'setup',
			async run(ctx) {
				const { page, h } = ctx;
				const items = await Promise.all(['src', 'greet.ts', 'README.md'].map(name => h.box(page.getByRole('treeitem', { name }))));
				const tree = { x: items[0].x, y: items[0].y - 4, width: Math.max(...items.map(i => i.width)), height: items[2].y + items[2].height - items[0].y + 8 };
				await h.hover(page.getByRole('treeitem', { name: 'greet.ts' }), { ms: 300, fx: 0.3 });
				await ctx.look(tree);
				await ctx.at(ctx.cue('start'));
				await h.hover(page.getByRole('treeitem', { name: 'README.md' }), { ms: 300, fx: 0.35 });
				await ctx.look(tree);
				// The page is served (the tester's own server; here, one on 127.0.0.1:8642), and the setting is set.
				const response = await fetch(PAGE);
				const html = await response.text();
				if (response.status !== 200 || !html.includes('Local review page')) {
					throw new Error(`The test page is not served: ${response.status}`);
				}
				const settings = JSON.parse(fs.readFileSync(path.join(ctx.paths.data, 'User/settings.json'), 'utf8'));
				if (settings['workbench.browser.openLocalhostLinks'] !== true) {
					throw new Error('workbench.browser.openLocalhostLinks is not true');
				}
				await ctx.hold(1.15);
				await expectNothingOutside(ctx);
				return `Folder links-demo (README.md, src/greet.ts), README.md open; ${PAGE} → ${response.status}; "workbench.browser.openLocalhostLinks": true in User Settings.`;
			}
		},
		{
			id: 'open',
			async run(ctx) {
				const { page, h } = ctx;
				await ctx.at(0.05);
				await h.press('Meta+P');
				const input = quickInput(page);
				await input.waitFor({ timeout: 3000 });
				const placeholder = await input.getAttribute('placeholder');
				if (placeholder !== 'Search files by name (append : to go to line or @ to go to symbol), or paste a link') {
					throw new Error(`Placeholder: ${placeholder}`);
				}
				const ib = await h.box(input);
				await ctx.look({ x: ib.x + ib.width - 250, y: ib.y - 4, width: 250, height: ib.height + 8 });
				// The placeholder for about 1.3 s, then the link, pasted.
				await ctx.at(ctx.cue('Quick') + 0.45);
				const link = fileLink(ctx, 'src/greet.ts', '#L3');
				await page.keyboard.insertText(link);
				await expectLinkRow(page, link);
				const rb = await h.box(firstRow(page));
				await ctx.look({ x: rb.x - 25, y: rb.y, width: 300, height: rb.height });
				await ctx.at(ctx.cue('Press') + 0.12);
				await h.press('Enter');
				const opened = await waitFor(page, 'greet.ts on line 3 in the same group', async () => {
					const g = await groups(page);
					const sel = await selectionItem(page).textContent().catch(() => null);
					return { ok: g.length === 1 && g[0].tab === 'greet.ts' && g[0].tabs.includes('README.md') && sel?.trim() === 'Ln 3, Col 1' && !(await page.locator(QI).isVisible()), g: g.map(x => [x.tab, x.tabs]), sel };
				});
				await ctx.look(await lineBox(page, 0, 3));
				await ctx.at(ctx.cue('line') - 0.25);
				await ctx.look(selectionItem(page));
				await shot(ctx, 'open');
				await ctx.hold();
				await expectNothingOutside(ctx);
				return `Placeholder "${placeholder}"; one row "Open Link" ${link} / "${HINT}" / button "${SIDE}"; Enter: greet.ts in the same group (tabs ${opened.g[0][1].join(', ')}), status bar "${opened.sel.trim()}".`;
			}
		},
		{
			id: 'side',
			async run(ctx) {
				const { page, h } = ctx;
				const readmeTab = page.locator('.editor-group-container').first().locator('.tab').filter({ hasText: 'README.md' }).first();
				await ctx.look(await h.hover(readmeTab, { ms: 300 }));
				await h.click();
				await waitFor(page, 'README.md active', async () => {
					const g = await groups(page);
					return { ok: g.length === 1 && g[0].tab === 'README.md', g: g.map(x => x.tab) };
				}, 2000);
				await ctx.at(ctx.cue('paste') - 0.35);
				await h.press('Meta+P');
				await quickInput(page).waitFor({ timeout: 3000 });
				await ctx.at(ctx.cue('paste') - 0.1);
				const link = fileLink(ctx, 'src/greet.ts', '#L3');
				await page.keyboard.insertText(link);
				await expectLinkRow(page, link);
				const rb = await h.box(firstRow(page));
				await ctx.look({ x: rb.x, y: rb.y + rb.height / 2, width: 300, height: rb.height / 2 });
				await ctx.at(ctx.cue('Option') - 0.05);
				await h.press('Alt+Enter');
				const opened = await waitFor(page, 'greet.ts on line 3 in a second group, README.md still shown in the first', async () => {
					const g = await groups(page);
					const sel = await selectionItem(page).textContent().catch(() => null);
					return { ok: g.length === 2 && g[0].tab === 'README.md' && g[0].text?.includes('Links demo') && g[1].active && g[1].tab === 'greet.ts' && sel?.trim() === 'Ln 3, Col 1', g: g.map(x => [x.active, x.tab]), sel };
				});
				await ctx.look(await lineBox(page, 1, 3));
				await ctx.at(ctx.cue('README', 1) - 0.3);
				const g1 = (await groups(page))[0].box;
				await ctx.look({ x: g1.x + 10, y: g1.y + 60, width: 300, height: 80 });
				await shot(ctx, 'side');
				await ctx.hold();
				await expectNothingOutside(ctx);
				return `⌥Enter: greet.ts opened in group 2 (active, status "${opened.sel.trim()}"); group 1 still shows README.md.`;
			}
		},
		{
			id: 'handlers',
			async run(ctx) {
				const { page, h } = ctx;
				await focusReadme(ctx);
				const before = pageRequests();
				await ctx.at(0.55);
				await h.press('Meta+P');
				await quickInput(page).waitFor({ timeout: 3000 });
				await ctx.at(0.8);
				await page.keyboard.insertText(LOCAL);
				await expectLinkRow(page, LOCAL);
				const button = firstRow(page).getByRole('button', { name: SIDE }).or(firstRow(page).locator(`.action-label[aria-label="${SIDE}"]`)).first();
				await ctx.at(1.1);
				const bb = await h.hover(button, { ms: 350 });
				await ctx.look({ x: bb.x + bb.width - 280, y: bb.y - 8, width: 290, height: bb.height + 16 });
				await ctx.at(ctx.cue('side') - 0.05);
				await h.click();
				// The browser's address bar: a textbox named "Address", in the new group beside README.md.
				const address = page.getByRole('textbox', { name: 'Address' });
				const opened = await waitFor(page, 'the integrated browser beside README.md, with the whole link', async () => {
					const g = await groups(page);
					const browser = g.findIndex(x => x.tab === 'Local review page');
					const url = await address.evaluate(e => e.value ?? e.querySelector('input')?.value ?? e.textContent?.replace(/\u00a0/g, ' ').trim() ?? null).catch(() => null);
					const ab = await address.boundingBox().catch(() => null);
					const inBrowserGroup = !!ab && browser >= 0 && ab.x >= g[browser].box.x && ab.x + ab.width <= g[browser].box.x + g[browser].box.width;
					return { ok: g.length === 3 && browser === 1 && g[1].active && url === LOCAL && inBrowserGroup && g[0].tab === 'README.md' && g[0].text?.includes('Links demo') && g[2].tab === 'greet.ts' && pageRequests() > before, g: g.map(x => [x.active, x.tab]), url, inBrowserGroup, requests: pageRequests() - before };
				}, 8000);
				const ub = await h.box(address);
				await ctx.look({ x: ub.x, y: ub.y - 6, width: 300, height: ub.height + 12 });
				// "next to the README": README.md, still shown in group 1. The pointer stays off the page: the browser's
				// native view would hide it.
				await ctx.at(ctx.cue('next') - 0.3);
				const g1 = (await groups(page))[0].box;
				await ctx.look({ x: g1.x + 10, y: g1.y + 60, width: 300, height: 80 });
				await h.glide(g1.x + g1.width / 2, g1.y + 300, 350);
				await shot(ctx, 'handlers');
				await ctx.hold();
				await expectNothingOutside(ctx);
				const locked = await page.evaluate(() => [...document.querySelectorAll('.editor-group-container')].map(g => g.classList.contains('locked')));
				return `Side button: "Local review page" in the integrated browser, in a new group right of README.md (groups: ${opened.g.map(x => x[1]).join(' | ')}; locked: ${JSON.stringify(locked)}); Address "${opened.url}"; the server got GET /review.html?pr=342081 (${opened.requests}); nothing opened outside VS Code.`;
			}
		},
		{
			// The browser's address bar keeps the whole link, its query and fragment included. The bar is narrower than
			// the link: a click opens it for editing (all selected), and End shows the link's end.
			id: 'address',
			async run(ctx) {
				const { page, h } = ctx;
				const display = page.locator('.editor-group-container.active .browser-url-display').first();
				const db = await h.box(display);
				await h.glide(db.x + 40, db.y + db.height / 2, 300);
				await ctx.look({ x: db.x - 10, y: db.y - 8, width: 250, height: db.height + 16 });
				await ctx.at(ctx.cue('bar') - 0.05);
				await h.click();
				const input = quickInput(page);
				const picked = await waitFor(page, 'the address picker with the whole link, all selected', async () => {
					const s = await input.evaluate(i => ({ value: i.value, sel: [i.selectionStart, i.selectionEnd], width: i.getBoundingClientRect().width })).catch(() => null);
					return { ok: !!s && s.width > 0 && s.value === LOCAL && s.sel[0] === 0 && s.sel[1] === LOCAL.length, s };
				}, 2000);
				const pb = await h.box(input);
				await ctx.look({ x: pb.x - 10, y: pb.y - 8, width: 250, height: pb.height + 16 });
				await ctx.at(ctx.cue('keeps') - 0.15);
				await h.press('End');
				const end = await waitFor(page, 'the end of the link in view', async () => {
					const s = await input.evaluate(i => ({ value: i.value, sel: [i.selectionStart, i.selectionEnd], scrollLeft: i.scrollLeft, scrollWidth: i.scrollWidth, clientWidth: i.clientWidth }));
					return { ok: s.value === LOCAL && s.sel[0] === LOCAL.length && s.sel[1] === LOCAL.length && s.scrollLeft > 0 && s.scrollLeft + s.clientWidth >= s.scrollWidth - 1, s };
				}, 2000);
				await ctx.look({ x: pb.x - 10, y: pb.y - 8, width: 250, height: pb.height + 16 });
				// The pointer leaves the link's text.
				const g1 = (await groups(page))[0].box;
				await h.glide(g1.x + g1.width / 2, g1.y + 300, 350);
				await shot(ctx, 'address');
				await ctx.hold(0.6);
				await expectNothingOutside(ctx);
				return `Address bar clicked: a picker holding "${picked.s.value}", all selected; End: the link's end in view (scrolled ${Math.round(end.s.scrollLeft)} px, to the end); nothing opened outside VS Code.`;
			}
		},
		{
			// The PR's live step 4: another localhost link, with the side button again, reuses the browser's side group.
			id: 'reuse',
			async run(ctx) {
				const { page, h } = ctx;
				const before = await groups(page);
				if (before.length !== 3 || before[1].tabs.join() !== 'Local review page' || !before[1].locked) {
					throw new Error(`Expected the browser alone in a locked group 2: ${JSON.stringify(before.map(x => [x.tabs, x.locked]))}`);
				}
				await focusReadme(ctx);
				const requests = pageRequests('pr=342081&page=2');
				await ctx.at(0.5);
				await h.press('Meta+P');
				await quickInput(page).waitFor({ timeout: 3000 });
				await ctx.at(0.75);
				await page.keyboard.insertText(LOCAL2);
				await expectLinkRow(page, LOCAL2);
				const ib = await h.box(quickInput(page));
				await ctx.look({ x: ib.x + ib.width - 260, y: ib.y - 4, width: 260, height: ib.height + 8 });
				const button = firstRow(page).getByRole('button', { name: SIDE }).or(firstRow(page).locator(`.action-label[aria-label="${SIDE}"]`)).first();
				await ctx.at(ctx.cue('side') - 0.1);
				const bb = await h.hover(button, { ms: 350 });
				await ctx.look({ x: bb.x + bb.width - 280, y: bb.y - 8, width: 290, height: bb.height + 16 });
				await ctx.at(ctx.cue('opens') - 0.1);
				await h.click();
				const address = page.getByRole('textbox', { name: 'Address' });
				const opened = await waitFor(page, 'a second browser tab in the same locked group, README.md still shown', async () => {
					const g = await groups(page);
					const url = await address.evaluate(e => e.textContent?.replace(/\u00a0/g, ' ').trim() ?? null).catch(() => null);
					const ab = await address.boundingBox().catch(() => null);
					const inGroup2 = !!ab && g.length === 3 && ab.x >= g[1].box.x && ab.x + ab.width <= g[1].box.x + g[1].box.width;
					return {
						ok: g.length === 3 && g[0].tab === 'README.md' && g[0].text?.includes('Links demo') && g[1].active && g[1].locked && g[1].tabs.join() === 'Local review page,Local review page'
							&& url === LOCAL2 && inGroup2 && g[2].tab === 'greet.ts' && pageRequests('pr=342081&page=2') > requests,
						g: g.map(x => [x.active, x.locked, x.tabs]), url, inGroup2, requests: pageRequests('pr=342081&page=2') - requests,
					};
				}, 8000);
				// The pointer leaves the page: the browser's native view would hide it.
				const g0 = (await groups(page))[0].box;
				await h.glide(g0.x + g0.width / 2, g0.y + 300, 300);
				const g1 = (await groups(page))[1].box;
				await ctx.at(ctx.cue('tab') - 0.2);
				await ctx.look({ x: g1.x, y: g1.y, width: 330, height: 76 });
				await ctx.at(ctx.cue('README') - 0.25);
				await ctx.look({ x: g0.x + 10, y: g0.y + 60, width: 300, height: 80 });
				await shot(ctx, 'reuse');
				await ctx.hold();
				await expectNothingOutside(ctx);
				if (probing && process.argv[process.argv.indexOf('--until') + 1] === 'reuse') {
					// Probe only (--until reuse): a 404 page keeps the whole link too (a tester's folder may have no review.html).
					await focusReadme(ctx);
					const notFound = 'http://127.0.0.1:8642/nothere.html?pr=342081#changes';
					await h.press('Meta+P');
					await quickInput(page).waitFor({ timeout: 3000 });
					await page.keyboard.insertText(notFound);
					await expectLinkRow(page, notFound);
					await h.press('Enter');
					await page.waitForTimeout(2500);
					const seen = await page.evaluate(() => {
						const g = document.querySelector('.editor-group-container.active');
						return { tab: g?.querySelector('.tab.active .label-name')?.textContent, url: g?.querySelector('.browser-url-display')?.textContent, tabs: [...g.querySelectorAll('.tab .label-name')].map(t => t.textContent) };
					});
					console.log('NOTFOUND', JSON.stringify(seen), JSON.stringify((await groups(page)).map(x => [x.active, x.locked, x.tabs])));
					await shot(ctx, 'notfound');
					await expectNothingOutside(ctx);
				}
				return `Side button again: a second "Local review page" tab in group 2, still locked (groups: ${opened.g.map(x => `${x[0] ? '*' : ''}${x[2].join(', ')}${x[1] ? ' (locked)' : ''}`).join(' | ')}); Address "${opened.url}"; the server got GET /review.html?pr=342081&page=2 (${opened.requests}); README.md still shown in group 1; nothing opened outside VS Code.`;
			}
		},
		{
			id: 'prefixes',
			async run(ctx) {
				const { page, h } = ctx;
				await focusReadme(ctx);
				await ctx.at(0.45);
				await h.press('Meta+P');
				await quickInput(page).waitFor({ timeout: 3000 });
				await ctx.at(0.7);
				await h.type('greet.ts:3', 20);
				const file = await waitFor(page, 'a greet.ts file result', async () => {
					const all = await rows(page);
					return { ok: all[0]?.label === 'greet.ts' && !all.some(r => r.label.endsWith('Open Link') || r.label === 'Invalid Link'), all: all.slice(0, 3) };
				});
				const rb = await h.box(firstRow(page));
				await ctx.look({ x: rb.x, y: rb.y, width: 300, height: rb.height });
				const seen = [`greet.ts:3 → ${file.all[0].label} (${file.all[0].description})`];
				for (const [query, cue, test] of [
					['>', ctx.cue('So'), all => all.length > 3 && all.some(r => r.label === 'Accounts: Manage Accounts')],
					['@', ctx.cue('and') - 0.05, all => all.length === 1 && all[0].label.includes('Links demo')],
				]) {
					await ctx.at(cue);
					await page.keyboard.press('Meta+A');
					await h.type(query);
					const got = await waitFor(page, `results for "${query}"`, async () => {
						const all = await rows(page);
						return { ok: test(all) && !all.some(r => r.label.endsWith('Open Link') || r.label === 'Invalid Link'), all: all.slice(0, 3) };
					});
					await ctx.look({ x: rb.x, y: rb.y, width: 300, height: rb.height });
					seen.push(`${query} → ${got.all.map(r => r.label).join(', ')}`);
					await shot(ctx, `prefix-${query === '>' ? 'commands' : 'symbols'}`);
				}
				await ctx.hold(0.45);
				await page.keyboard.press('Escape');
				await expectNothingOutside(ctx);
				return seen.join('; ');
			}
		},
		{
			id: 'invalid',
			async run(ctx) {
				const { page, h } = ctx;
				await ctx.at(0.05);
				await h.press('Meta+P');
				await quickInput(page).waitFor({ timeout: 3000 });
				await ctx.at(0.3);
				// An unencoded space makes the link malformed (Quick Open rejects whitespace and backslashes).
				const link = `${fileLink(ctx, 'src')}/my notes.md`;
				await page.keyboard.insertText(link);
				const invalid = await waitFor(page, 'one Invalid Link row', async () => {
					const all = await rows(page);
					return { ok: all.length === 1 && all[0].label === 'Invalid Link' && all[0].description === INVALID && all[0].buttons.length === 0, all };
				});
				const rb = await h.box(firstRow(page));
				await ctx.look({ x: rb.x - 25, y: rb.y - 4, width: 300, height: rb.height + 8 });
				await shot(ctx, 'invalid');
				const tabs = JSON.stringify((await groups(page)).map(x => x.tabs));
				await ctx.at(ctx.cue('Enter') - 0.05);
				await h.press('Enter');
				await page.waitForTimeout(500);
				const after = { visible: await page.locator(QI).isVisible(), value: await quickInput(page).inputValue(), tabs: JSON.stringify((await groups(page)).map(x => x.tabs)), dialog: await page.locator('.monaco-dialog-box').count() };
				if (!after.visible || after.value !== link || after.tabs !== tabs || after.dialog) {
					throw new Error(`Enter on Invalid Link did something: ${JSON.stringify(after)}`);
				}
				await ctx.hold();
				await expectNothingOutside(ctx);
				return `"${invalid.all[0].label}" / "${invalid.all[0].description}", no buttons; Enter: Quick Open stays, nothing opens.`;
			}
		},
		{
			id: 'missing',
			async run(ctx) {
				const { page, h } = ctx;
				const missing = path.join(ctx.paths.workspace, 'src/missing.ts');
				await ctx.at(0.05);
				await page.keyboard.press('Meta+A');
				const link = fileLink(ctx, 'src/missing.ts');
				await page.keyboard.insertText(link);
				await expectLinkRow(page, link);
				const rb = await h.box(firstRow(page));
				await ctx.look({ x: rb.x, y: rb.y, width: 300, height: rb.height });
				await ctx.at(ctx.cue('missing') - 0.05);
				await h.press('Enter');
				const dialog = page.locator('.monaco-dialog-box');
				const shown = await waitFor(page, 'the file-not-found dialog', async () => {
					const text = await dialog.innerText().catch(() => '');
					const buttons = await dialog.locator('.monaco-button').evaluateAll(b => b.map(x => x.textContent.trim())).catch(() => []);
					return { ok: text.includes('Unable to open \'missing.ts\'') && text.includes('The editor could not be opened because the file was not found.') && buttons.join() === 'Cancel,Create File', text, buttons };
				});
				await ctx.look(dialog);
				await shot(ctx, 'missing');
				const cancel = dialog.locator('.monaco-button').filter({ hasText: 'Cancel' });
				await ctx.at(ctx.cue('Cancel') - 0.4);
				await h.hover(cancel, { ms: 300 });
				await ctx.at(ctx.cue('Cancel') - 0.02);
				await h.click();
				const closed = await waitFor(page, 'the dialog and the missing.ts tab gone', async () => {
					const g = await groups(page);
					return { ok: !(await dialog.count()) && !g.some(x => x.tabs.includes('missing.ts')) && g[0].tab === 'README.md', g: g.map(x => x.tabs) };
				});
				const g0 = (await groups(page))[0].box;
				await ctx.look({ x: g0.x, y: g0.y, width: 300, height: 40 });
				if (fs.existsSync(missing)) {
					throw new Error('missing.ts was created');
				}
				await ctx.hold(0.6);
				await expectNothingOutside(ctx);
				return `Dialog "${shown.text.replace(/\n+/g, ' / ')}" (${shown.buttons.join(', ')}); Cancel: dialog and tab gone (tabs ${JSON.stringify(closed.g)}), no file created; nothing opened outside VS Code.`;
			}
		},
	],
};
