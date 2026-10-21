// Helpers for how-to-test scenarios: a pointer, click rings and key badges drawn into the page (the recording has no
// cursor), smooth pointer moves, and a few VS Code moves (open a folder in the Agents window, Quick Open a file).

/** Drawn above everything. Built with DOM calls: the workbench's Trusted Types policy rejects innerHTML. */
function overlay() {
	if (window.__tpiOverlay) {
		return;
	}
	const NS = 'http://www.w3.org/2000/svg';
	const root = document.createElement('div');
	root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
	const pointer = document.createElement('div');
	pointer.style.cssText = 'position:absolute;left:0;top:0;width:30px;height:30px;transform:translate(-200px,-200px)';
	const svg = document.createElementNS(NS, 'svg');
	svg.setAttribute('width', '30');
	svg.setAttribute('height', '30');
	svg.setAttribute('viewBox', '0 0 26 26');
	const arrow = document.createElementNS(NS, 'path');
	arrow.setAttribute('d', 'M3 2 L3 21 L8 16.5 L11.5 24 L15 22.5 L11.6 15.2 L18 15.2 Z');
	arrow.setAttribute('fill', '#ffffff');
	arrow.setAttribute('stroke', '#000000');
	arrow.setAttribute('stroke-width', '1.6');
	arrow.setAttribute('stroke-linejoin', 'round');
	svg.appendChild(arrow);
	pointer.appendChild(svg);
	root.appendChild(pointer);
	const badge = document.createElement('div');
	badge.style.cssText = 'position:absolute;left:50%;bottom:90px;transform:translateX(-50%);padding:10px 22px;border-radius:12px;background:rgba(18,18,18,.92);color:#fff;font:600 30px -apple-system,system-ui,sans-serif;letter-spacing:.05em;border:2px solid #fff;opacity:0;transition:opacity .15s;white-space:nowrap';
	root.appendChild(badge);
	document.body.appendChild(root);
	const place = (x, y) => {
		pointer.style.transform = `translate(${x - 3}px,${y - 2}px)`;
	};
	// The drawn pointer follows only the kit's own moves (glide sets __tpiGliding), so the mouse moves Chromium
	// synthesizes at the real cursor (after a menu or picker closes, or when someone uses the Mac) never make it jump.
	window.__tpiGliding = false;
	window.__tpiPointer = place;
	window.addEventListener('mousemove', e => {
		if (window.__tpiGliding) {
			place(e.clientX, e.clientY);
		}
	}, true);
	window.addEventListener('mousedown', e => {
		place(e.clientX, e.clientY);
		const ring = document.createElement('div');
		ring.style.cssText = `position:absolute;left:${e.clientX}px;top:${e.clientY}px;width:44px;height:44px;margin:-22px 0 0 -22px;border:3px solid #ffd400;border-radius:50%;transform:scale(.4);opacity:1;transition:transform .45s ease-out,opacity .45s ease-out`;
		root.appendChild(ring);
		requestAnimationFrame(() => requestAnimationFrame(() => {
			ring.style.transform = 'scale(1.35)';
			ring.style.opacity = '0';
		}));
		setTimeout(() => ring.remove(), 700);
	}, true);
	let hide;
	window.__tpiBadge = (text, ms) => {
		badge.textContent = text;
		badge.style.opacity = '1';
		clearTimeout(hide);
		hide = setTimeout(() => { badge.style.opacity = '0'; }, ms ?? 1000);
	};
	window.__tpiOverlay = true;
}

/**
 * The helpers a step gets as `ctx.h`. Every pointer helper draws the overlay first (a reload removes it), and keeps
 * track of where the pointer is so the next move starts from there.
 */
const MODIFIERS = { Control: '\u2303', Alt: '\u2325', Shift: '\u21e7', Meta: '\u2318', ControlOrMeta: '\u2318' };

/** Modifiers as the Mac shows them, ⌃⌥⇧⌘ first, then `name`: (['Meta', 'Shift'], 'P') -> ⇧⌘P. */
function keyLabel(modifiers, name = '') {
	return Object.keys(MODIFIERS).filter(m => modifiers.includes(m)).map(m => MODIFIERS[m]).join('') + name;
}

export function makeHelpers(page) {
	let cursor = { x: 800, y: 500 };
	const ensure = () => page.evaluate(overlay);

	async function box(locator) {
		const found = await locator.boundingBox();
		if (!found) {
			throw new Error(`Not visible: ${locator}`);
		}
		return found;
	}

	/** Moves the pointer to (x, y) over `ms`, eased, so it is seen travelling. */
	async function glide(x, y, ms = 300) {
		await ensure();
		await page.evaluate(() => { window.__tpiGliding = true; });
		const from = { ...cursor };
		const start = Date.now();
		try {
			for (;;) {
				const p = Math.min(1, (Date.now() - start) / ms);
				const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
				await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
				if (p >= 1) {
					break;
				}
				await page.waitForTimeout(12);
			}
		} finally {
			await page.evaluate(([px, py]) => {
				window.__tpiGliding = false;
				window.__tpiPointer?.(px, py);
			}, [x, y]).catch(() => { });
		}
		cursor = { x, y };
	}

	/** Glides onto a locator (`fx`, `fy`: where on it, 0-1) and returns its box. */
	async function hover(locator, { ms = 300, fx = 0.5, fy = 0.5 } = {}) {
		const b = await box(locator);
		await glide(b.x + b.width * fx, b.y + b.height * fy, ms);
		return b;
	}

	/**
	 * A click where the pointer is (the ring shows it). `button: 'right'` right-clicks; `modifiers` (['Meta']) are held
	 * through it and shown in the badge ("⌘ click").
	 */
	async function click({ button = 'left', modifiers = [], ...unknown } = {}) {
		if (Object.keys(unknown).length) {
			throw new Error(`click() takes { button, modifiers }, not ${JSON.stringify(unknown)}`);
		}
		await ensure();
		if (modifiers.length) {
			await badge(`${keyLabel(modifiers)} click`);
		}
		for (const m of modifiers) {
			await page.keyboard.down(m);
		}
		await page.mouse.down({ button });
		await page.waitForTimeout(70);
		await page.mouse.up({ button });
		for (const m of [...modifiers].reverse()) {
			await page.keyboard.up(m);
		}
	}

	/** Shows `text` in the key badge for `ms`. */
	async function badge(text, ms = 1000) {
		await ensure();
		await page.evaluate(([t, m]) => window.__tpiBadge(t, m), [text, ms]);
	}

	/** Presses `key` (Playwright names: 'Meta+P', 'ArrowRight'), showing `label` (default: the key, ⇧⌘P) in the badge. */
	async function press(key, label) {
		const parts = key.split(/\+(?=.)/);
		const name = parts.pop();
		await badge(label ?? keyLabel(parts, name));
		await page.keyboard.press(key);
	}

	async function type(text, delay = 15) {
		await page.keyboard.type(text, { delay });
	}

	/**
	 * Inserts `text` where the focus is, the way a paste does (one input event), without touching the Mac's clipboard,
	 * and shows ⌘V in the badge. For an editor, click its `.view-lines` first.
	 */
	async function paste(text) {
		await badge('\u2318V');
		await page.keyboard.insertText(text);
	}

	/** Quick Open (Cmd+P) a file by name. */
	async function quickOpen(name, { badgeIt = false } = {}) {
		if (badgeIt) {
			await press('Meta+P');
		} else {
			await page.keyboard.press('Meta+P');
		}
		await page.waitForTimeout(400);
		await type(name);
		await page.waitForTimeout(650);
		await page.keyboard.press('Enter');
		await page.waitForTimeout(400);
	}

	/** Opens `folder` in the Agents window's new-session view (the workspace picker, then the simple folder dialog). */
	async function agentsOpenFolder(folder) {
		// The simple dialog sometimes changes the typed path, and the folder sometimes doesn't open: check both, retry.
		const target = folder.replace(/\/?$/, '/');
		const name = folder.replace(/\/+$/, '').split('/').pop();
		for (let attempt = 0; attempt < 4; attempt++) {
			await page.getByRole('button', { name: /^Workspace:/ }).first().click({ timeout: 30000 });
			await page.getByRole('option', { name: /Open Folder/ }).click({ timeout: 10000 });
			const box = page.getByRole('textbox', { name: 'Folder path' });
			await box.waitFor({ timeout: 10000 });
			for (let i = 0; i < 3 && (await box.inputValue()) !== target; i++) {
				await box.fill(target);
				await page.waitForTimeout(500);
			}
			if ((await box.inputValue()) === target) {
				await page.getByRole('button', { name: 'OK', exact: true }).click();
				if (await page.getByRole('button', { name: `Workspace: ${name}` }).first().waitFor({ timeout: 10000 }).then(() => true, () => false)) {
					await page.waitForTimeout(1000);
					return;
				}
			}
			await page.keyboard.press('Escape');
			await page.waitForTimeout(1000);
		}
		throw new Error(`The folder did not open: ${folder}`);
	}

	/** The quick input (Command Palette or a picker): open, focus in its input, its text, the focused row's label. */
	function quickInput() {
		return page.evaluate(() => {
			const widget = document.querySelector('.quick-input-widget');
			const input = widget?.querySelector('input');
			const open = !!widget && widget.getBoundingClientRect().height > 0 && getComputedStyle(widget).display !== 'none';
			return {
				open,
				focused: !!input && document.activeElement === input,
				value: open ? input?.value ?? null : null,
				picked: open ? widget.querySelector('.monaco-list-row.focused')?.getAttribute('aria-label') ?? null : null,
				rows: open ? [...widget.querySelectorAll('.monaco-list-row')].slice(0, 12).map(r => r.getAttribute('aria-label')) : [],
			};
		});
	}

	async function until(check, what, ms) {
		const end = Date.now() + ms;
		for (;;) {
			const value = await check();
			if (value) {
				return value;
			}
			if (Date.now() > end) {
				throw new Error(`Timed out waiting for ${what}: ${JSON.stringify(await quickInput())}`);
			}
			await page.waitForTimeout(30);
		}
	}

	/**
	 * Moves the open picker's focus to the row labeled exactly `label`; throws if it has none. A row's accessible label
	 * may go on after a comma (its keybinding, "recently used", "similar commands").
	 */
	async function pickRow(label) {
		const exact = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(, .*)?$`);
		for (let i = 0; i < 15; i++) {
			if (exact.test((await quickInput()).picked ?? '')) {
				return;
			}
			await page.keyboard.press('ArrowDown');
			await page.waitForTimeout(40);
		}
		const q = await quickInput();
		throw new Error(`The picker has no row "${label}" (typed "${q.value}"). Its rows: ${JSON.stringify(q.rows)}`);
	}

	/**
	 * Runs a command from the Command Palette, showing ⇧⌘P in the badge: types `typed` (default: the label), moves to
	 * the row labeled exactly `label`, and presses Enter. Throws, without running anything, if there's no such row.
	 */
	async function command(label, typed = label) {
		await press('Meta+Shift+P');
		await until(async () => { const q = await quickInput(); return q.open && q.focused && q.value === '>'; }, 'the Command Palette', 3000);
		await type(typed, 12);
		await until(async () => (await quickInput()).value === `>${typed}`, `"${typed}" typed`, 3000);
		await page.waitForTimeout(250);
		await pickRow(label);
		await page.keyboard.press('Enter');
	}

	// Chat (signed in). The model picker's accessible name is "Models, <label>"; its options are menu radio items
	// named "<label>, …"; a running request shows a "Cancel (…)" button.
	const modelButton = () => page.getByRole('button', { name: /^Models, / }).first();
	const cancelButton = () => page.locator('[aria-label^="Cancel ("]').filter({ visible: true }).first();

	/** The model picker's label ("Claude Haiku 5.5"), or null. */
	async function modelLabel() {
		const name = await modelButton().getAttribute('aria-label', { timeout: 5000 }).catch(() => null);
		return name?.replace(/^Models, /, '') ?? null;
	}

	/**
	 * Picks `name` in the model picker unless it's already picked, and checks the picker's label (throws otherwise).
	 * Call it before every send: the default model differs between runs. The list can re-render while its menu is open,
	 * so clicks are bounded and retried. Not drawn: do it in a hidden step or before the step's narration.
	 */
	async function pickModel(name) {
		const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const option = page.getByRole('menuitemradio', { name: new RegExp(`^${escaped},`) });
		for (let attempt = 0; attempt < 6 && await modelLabel() !== name; attempt++) {
			await modelButton().click({ timeout: 5000 }).catch(() => { });
			const picked = await option.waitFor({ timeout: 3000 }).then(() => option.click({ timeout: 3000 })).then(() => true, () => false);
			if (!picked) {
				await page.keyboard.press('Escape');
				await page.waitForTimeout(1000);
			}
			await page.waitForTimeout(300);
		}
		const label = await modelLabel();
		if (label !== name) {
			throw new Error(`The model picker says "${label}", not "${name}"`);
		}
		return label;
	}

	/** Whether a chat request is running in the shown chat. */
	async function chatRunning() {
		return (await cancelButton().count()) > 0;
	}

	/** Cancels a running chat request (with the pointer, so it shows), and waits until it stopped. */
	async function cancelChat() {
		if (!await chatRunning()) {
			return false;
		}
		await hover(cancelButton(), { ms: 250 });
		await click();
		const end = Date.now() + 10000;
		while (await chatRunning()) {
			if (Date.now() > end) {
				throw new Error('The chat request did not stop');
			}
			await page.waitForTimeout(200);
		}
		return true;
	}

	return { box, glide, hover, click, badge, press, type, paste, quickOpen, agentsOpenFolder, command, pickRow, quickInput, modelLabel, pickModel, chatRunning, cancelChat, overlay: ensure, get cursor() { return { ...cursor }; } };
}
