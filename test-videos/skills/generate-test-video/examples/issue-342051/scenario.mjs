// #342051, criteria 1-3. Opens only file: links and its own 127.0.0.1 page; Electron's shell is stubbed.
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PAGE = 'http://127.0.0.1:8642/review.html';
const LOCAL = `${PAGE}?pr=342081#changes`;
const QI = '.quick-input-widget';
const requests = [];

/** The tester's localhost page, served until the run ends. */
async function serve() {
	const server = http.createServer((req, res) => {
		requests.push(req.url);
		res.writeHead(200, { 'content-type': 'text/html' });
		res.end('<title>Local review page</title><h1>Local review page</h1>');
	});
	await new Promise(resolve => server.listen(8642, '127.0.0.1', resolve));
	server.unref();
}

const fileLink = ctx => pathToFileURL(path.join(ctx.paths.workspace, 'src/greet.ts')).href + '#L3';
const input = page => page.locator(`${QI} .quick-input-box input`).first();
const row = page => page.locator(`${QI} .monaco-list-row`).first();
const status = page => page.locator('#status\\.editor\\.selection');

/** Polls `fn` until it returns { ok: true, ... }; after `ms`, throws with what it saw. */
async function until(page, what, fn, ms = 4000) {
	for (const end = Date.now() + ms; ;) {
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

/** The one Open Link row for `link`, with the Alt hint. */
const linkRow = (page, link) => until(page, `an Open Link row for ${link}`, async () => {
	const rows = await page.locator(`${QI} .monaco-list-row`).allTextContents();
	return { ok: rows.length === 1 && rows[0].includes('Open Link') && rows[0].includes(link) && rows[0].includes('Hold Alt while accepting'), rows };
});

/** The visible editor groups, left to right. */
const groups = page => page.evaluate(() => [...document.querySelectorAll('.editor-group-container')].map(g => ({
	active: g.classList.contains('active'),
	tab: g.querySelector('.tab.active .label-name')?.textContent?.trim() ?? null,
	box: g.getBoundingClientRect().toJSON(),
})).filter(g => g.box.width > 0).sort((a, b) => a.box.x - b.box.x));

/** Waits until the tabs read `tabs` (the last group active), on line 3. */
const showing = (page, tabs) => until(page, `${tabs} on line 3`, async () => {
	const g = await groups(page);
	const ln = (await status(page).textContent().catch(() => '')).trim();
	return { ok: g.map(x => x.tab).join(' | ') === tabs && g.at(-1).active && ln === 'Ln 3, Col 1', g, ln };
});

/** Zooms on README.md, in the left group. */
async function lookReadme(ctx) {
	const g = (await groups(ctx.page))[0].box;
	await ctx.look({ x: g.x + 10, y: g.y + 60, width: 300, height: 80 });
	return g;
}

/** Clicks README.md's tab, so Quick Open opens from its group. */
async function showReadme(ctx) {
	await ctx.look(await ctx.h.hover(ctx.page.locator('.editor-group-container').first().locator('.tab').filter({ hasText: 'README.md' }).first()));
	await ctx.h.click();
	await until(ctx.page, 'README.md active', async () => ({ ok: (await groups(ctx.page))[0].active }), 2000);
}

/** ⌘P, pastes `link` at `t` s into the step, and waits for its Open Link row. */
async function pasteLink(ctx, link, t) {
	await ctx.h.press('Meta+P');
	await input(ctx.page).waitFor({ timeout: 3000 });
	await ctx.at(t);
	await ctx.h.paste(link);
	await linkRow(ctx.page, link);
}

export default {
	signedIn: false,
	agents: false,
	settings: { 'workbench.browser.openLocalhostLinks': true },
	workspace: {
		name: 'links-demo',
		files: {
			'README.md': '# Links demo\n\nOpen links straight from Quick Open.\n',
			'src/greet.ts': 'export function greet(name: string) {\n\tconst greeting = \'Hello\';\n\treturn `${greeting}, ${name}!`;\n}\n',
		},
	},
	steps: [
		{
			id: 'prepare', hidden: true, async run(ctx) {
				const { page, h, app } = ctx;
				await serve();
				await app.evaluate(({ shell }) => {
					globalThis.__blocked = [];
					for (const name of ['openExternal', 'openPath']) {
						shell[name] = async (...args) => { globalThis.__blocked.push(`${name}(${args[0]})`); };
					}
				});
				await page.getByRole('treeitem', { name: 'src' }).click({ timeout: 30000 });
				await h.quickOpen('README.md');
				await until(page, 'README.md alone', async () => {
					const g = await groups(page);
					return { ok: g.length === 1 && g[0].tab === 'README.md', g };
				});
				return 'README.md open; the guard is on.';
			},
		},
		{
			id: 'setup', async run(ctx) {
				const { page, h } = ctx;
				await ctx.look(await h.hover(page.getByRole('treeitem', { name: 'greet.ts' }), { fx: 0.3 }));
				await ctx.at(ctx.cue('start'));
				await ctx.look(await h.hover(page.getByRole('treeitem', { name: 'README.md' }), { fx: 0.35 }));
				const response = await fetch(PAGE);
				if (response.status !== 200) {
					throw new Error(`The page answers ${response.status}`);
				}
				await ctx.hold(1.15);
				return `links-demo open; ${PAGE} answers 200.`;
			},
		},
		{
			id: 'open', async run(ctx) {
				const { page, h } = ctx;
				await ctx.at(0.05);
				await h.press('Meta+P');
				await input(page).waitFor({ timeout: 3000 });
				const placeholder = await input(page).getAttribute('placeholder');
				if (!placeholder.endsWith('or paste a link')) {
					throw new Error(`Placeholder: ${placeholder}`);
				}
				// The zoom shows ~265 px: the input's end, the row's start.
				const ib = await h.box(input(page));
				await ctx.look({ ...ib, x: ib.x + ib.width - 260, width: 260 });
				await ctx.at(ctx.cue('Quick') + 0.45);
				await h.paste(fileLink(ctx));
				await linkRow(page, fileLink(ctx));
				await ctx.look({ ...(await h.box(row(page))), width: 260 });
				await ctx.at(ctx.cue('Press') + 0.12);
				await h.press('Enter', '↵');
				await showing(page, 'greet.ts');
				await ctx.at(ctx.cue('line') - 0.25);
				await ctx.look(status(page));
				await ctx.hold();
				return `"${placeholder}"; an Open Link row; Enter: greet.ts, Ln 3, same group.`;
			},
		},
		{
			id: 'side', async run(ctx) {
				const { page, h } = ctx;
				await showReadme(ctx);
				await ctx.at(ctx.cue('paste') - 0.35);
				await pasteLink(ctx, fileLink(ctx), ctx.cue('paste') - 0.1);
				await ctx.look(row(page).locator('.quick-input-list-label-meta'));
				await ctx.at(ctx.cue('Option') - 0.05);
				await h.press('Alt+Enter');
				await showing(page, 'README.md | greet.ts');
				await ctx.look(status(page));
				await ctx.at(ctx.cue('README', 1) - 0.3);
				await lookReadme(ctx);
				await ctx.hold();
				return '⌥Enter: greet.ts on line 3 in a second group; README.md still in the first.';
			},
		},
		{
			id: 'handlers', async run(ctx) {
				const { page, h } = ctx;
				await showReadme(ctx);
				const before = requests.length;
				await ctx.at(0.55);
				await pasteLink(ctx, LOCAL, 0.8);
				await ctx.at(1.1);
				await ctx.look(await h.hover(row(page).locator('.action-label[aria-label="Open to the Side"]'), { ms: 350 }));
				await ctx.at(ctx.cue('side') - 0.05);
				await h.click();
				const address = page.getByRole('textbox', { name: 'Address' });
				const seen = await until(page, 'the browser beside README.md, at the whole link', async () => {
					const g = await groups(page);
					const url = (await address.textContent().catch(() => null))?.trim();
					return { ok: g.length === 3 && g[0].tab === 'README.md' && g[1].active && g[1].tab === 'Local review page' && url === LOCAL && requests.length > before, tabs: g.map(x => x.tab), url };
				}, 8000);
				await ctx.look(address);
				await ctx.at(ctx.cue('next') - 0.3);
				const g0 = await lookReadme(ctx);
				// Off the page: the browser's native view would hide the drawn pointer.
				await h.glide(g0.x + g0.width / 2, g0.y + 300, 350);
				await ctx.hold();
				const blocked = await ctx.app.evaluate(() => globalThis.__blocked);
				if (blocked.length) {
					throw new Error(`Opened outside VS Code: ${blocked}`);
				}
				return `The integrated browser beside README.md (${seen.tabs.join(' | ')}), at "${seen.url}"; nothing left VS Code.`;
			},
		},
	],
};
