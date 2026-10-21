// Headless Chrome for Testing, offline: only file:, data: and blob: requests are allowed while rendering.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

export function chromePath() {
	if (process.env.CHROME && fs.existsSync(process.env.CHROME)) {
		return process.env.CHROME;
	}
	const caches = [path.join(os.homedir(), 'Library/Caches/ms-playwright'), path.join(os.homedir(), '.cache/ms-playwright')];
	for (const cache of caches) {
		if (!fs.existsSync(cache)) {
			continue;
		}
		const versions = fs.readdirSync(cache).filter(n => /^chromium-\d+$/.test(n)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
		for (const v of versions) {
			for (const rel of [
				'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
				'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
				'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
				'chrome-linux/chrome', 'chrome-linux64/chrome',
			]) {
				const p = path.join(cache, v, rel);
				if (fs.existsSync(p)) {
					return p;
				}
			}
		}
	}
	return null;
}

export async function launch() {
	const executablePath = chromePath();
	if (!executablePath) {
		throw new Error('Chrome for Testing is missing. Run: npx playwright-core install chromium (or prs doctor)');
	}
	return chromium.launch({
		executablePath, headless: true,
		// macOS renders on the GPU (Metal); elsewhere, software rendering is the same on every machine and in CI.
		args: ['--headless=new', '--hide-scrollbars', '--force-color-profile=srgb',
			...(process.platform === 'darwin' && process.env.RENDER_GPU !== 'software'
				? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']
				: ['--disable-gpu', '--disable-dev-shm-usage', '--font-render-hinting=none'])],
	});
}

/** Opens build/index.html of a video. mode: all | content | captions. scale: 1 (1080p) or 0.5 (draft). */
export async function openVideo(browser, buildDir, { mode = 'all', scale = 1, search = '' } = {}) {
	const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
	const errors = [];
	page.on('pageerror', e => errors.push(e.stack || e.message));
	// Missing local Aptos files are expected on machines without Office (Linux, the cloud agent): Inter takes over.
	const optional = url => /Aptos/.test(url ?? '');
	page.on('console', m => {
		if (m.type() === 'error' && !optional(m.location()?.url)) {
			errors.push(m.text());
		}
	});
	page.on('requestfailed', r => {
		const url = r.url();
		// A picture replaced while it loads (a footage frame passed by) is cancelled; a missing one fails otherwise.
		const replaced = r.resourceType() === 'image' && r.failure()?.errorText === 'net::ERR_ABORTED';
		if (!optional(url) && !replaced) {
			errors.push(`${url}: ${r.failure()?.errorText}`);
		}
	});
	await page.route('**/*', route => {
		const url = new URL(route.request().url());
		if (['file:', 'data:', 'blob:'].includes(url.protocol)) {
			return route.continue();
		}
		errors.push(`Network request blocked during rendering: ${url.href}`);
		return route.abort();
	});
	const url = pathToFileURL(path.join(buildDir, 'index.html'));
	url.search = search;
	url.searchParams.set('mode', mode);
	await page.goto(url.href);
	const check = () => {
		if (errors.length) {
			const message = errors.join('\n');
			errors.length = 0;
			throw new Error(`The video page failed:\n${message}`);
		}
	};
	try {
		await page.waitForFunction(() => window.__READY__ === true, null, { timeout: 30000 });
	} catch (error) {
		check();
		throw error;
	}
	check();
	return {
		page, check,
		meta: () => page.evaluate(() => window.__VIDEO_META__),
		async renderAt(t) {
			await page.evaluate(x => window.renderAt(x), t);
			check();
		},
	};
}
