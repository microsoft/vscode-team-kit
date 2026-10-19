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
	window.addEventListener('mousemove', e => {
		pointer.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`;
	}, true);
	window.addEventListener('mousedown', e => {
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
		const from = { ...cursor };
		const start = Date.now();
		for (;;) {
			const p = Math.min(1, (Date.now() - start) / ms);
			const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
			await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
			if (p >= 1) {
				break;
			}
			await page.waitForTimeout(12);
		}
		cursor = { x, y };
	}

	/** Glides onto a locator (`fx`, `fy`: where on it, 0-1) and returns its box. */
	async function hover(locator, { ms = 300, fx = 0.5, fy = 0.5 } = {}) {
		const b = await box(locator);
		await glide(b.x + b.width * fx, b.y + b.height * fy, ms);
		return b;
	}

	/** A click where the pointer is (the ring shows it). */
	async function click() {
		await ensure();
		await page.mouse.down();
		await page.waitForTimeout(70);
		await page.mouse.up();
	}

	/** Shows `text` in the key badge for `ms`. */
	async function badge(text, ms = 1000) {
		await ensure();
		await page.evaluate(([t, m]) => window.__tpiBadge(t, m), [text, ms]);
	}

	/** Presses `key` (Playwright names: 'Meta+P', 'ArrowRight'), showing `label` (default: the key) in the badge. */
	async function press(key, label) {
		await badge(label ?? key.replace(/Meta\+/g, '\u2318').replace(/Shift\+/g, '\u21e7').replace(/Alt\+/g, '\u2325').replace(/Control\+/g, '\u2303'));
		await page.keyboard.press(key);
	}

	async function type(text, delay = 15) {
		await page.keyboard.type(text, { delay });
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

	/** Runs a command from the Command Palette, showing ⇧⌘P in the badge. */
	async function command(label) {
		await press('Meta+Shift+P');
		await page.waitForTimeout(350);
		await type(label, 12);
		await page.waitForTimeout(500);
		await page.keyboard.press('Enter');
	}

	return { box, glide, hover, click, badge, press, type, quickOpen, agentsOpenFolder, command, overlay: ensure, get cursor() { return { ...cursor }; } };
}
