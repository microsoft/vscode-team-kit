// prs demo on Linux: the environment VS Code gets inside a sandbox (gh-aw's agent firewall).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fontConfig, fontProblems, prepareLinuxEnv } from '../cli/lib/demo.mjs';

test('VS Code gets its own runtime dir, a font config, and the system libraries instead of the sandbox copies', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prs-demo-test-'));
	try {
		const env = { LD_LIBRARY_PATH: '/run/awf-lib/browser-libs/usr/lib/x86_64-linux-gnu:/opt/hostedtoolcache/Python/3.12.15/x64/lib', LD_PRELOAD: '/run/awf-lib/one-shot-token.so' };
		prepareLinuxEnv(env, tmp);
		const sandboxOnly = { LD_LIBRARY_PATH: '/run/awf-lib/browser-libs/usr/lib' };
		prepareLinuxEnv(sandboxOnly, fs.mkdtempSync(path.join(tmp, 'b-')));
		assert.deepStrictEqual({
			runtime: path.relative(tmp, env.XDG_RUNTIME_DIR),
			mode: (fs.statSync(env.XDG_RUNTIME_DIR).mode & 0o777).toString(8),
			libraries: env.LD_LIBRARY_PATH,
			preload: env.LD_PRELOAD,
			fonts: fs.existsSync(env.FONTCONFIG_FILE),
			sandboxOnly: 'LD_LIBRARY_PATH' in sandboxOnly,
		}, {
			runtime: 'run',
			mode: '700',
			libraries: '/opt/hostedtoolcache/Python/3.12.15/x64/lib',
			preload: '/run/awf-lib/one-shot-token.so',
			fonts: true,
			sandboxOnly: false,
		});
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test('VS Code on Linux gets pr-studio\'s fonts, ahead of the system\'s choices, without /etc/fonts', () => {
	const conf = fontConfig({ cache: '/tmp/prs-fonts' });
	const lines = conf.split('\n').map(l => l.trim());
	const first = family => lines.find(l => l.startsWith(`<alias binding="strong"><family>${family}</family>`))?.match(/<prefer><family>([^<]+)/)?.[1];
	const at = needle => lines.findIndex(l => l.includes(needle));
	assert.deepStrictEqual({
		ui: ['sans-serif', 'sans', 'system-ui', 'Ubuntu', 'Droid Sans'].map(first),
		code: ['monospace', 'mono', 'Droid Sans Mono'].map(first),
		// After the generic rules (45, 49), before 60-latin, which would put DejaVu Sans first.
		ordered: at('49-sansserif.conf') < at('<family>sans-serif</family>') && at('<family>serif</family>') < at('60-latin.conf'),
		etc: conf.includes('/etc/'),
		cache: lines.includes('<cachedir>/tmp/prs-fonts</cachedir>'),
	}, {
		ui: ['Inter', 'Inter', 'Inter', 'Inter', 'Inter'],
		code: ['DejaVu Sans Mono', 'DejaVu Sans Mono', 'DejaVu Sans Mono'],
		ordered: true,
		etc: false,
		cache: true,
	});
});

test('the fonts VS Code renders with are checked on Linux only', () => {
	assert.deepStrictEqual([
		fontProblems({ ui: 'Inter', mono: 'DejaVu Sans Mono' }, 'linux'),
		fontProblems({ ui: 'Inter Display', mono: 'dejavu sans mono' }, 'linux'),
		fontProblems({ ui: 'Liberation Serif', mono: 'FreeSerif' }, 'linux'),
		fontProblems(undefined, 'linux').length,
		fontProblems({ ui: '.SF NS', mono: 'Menlo' }, 'darwin'),
	], [
		[],
		[],
		['its UI renders in Liberation Serif, not Inter', 'its code renders in FreeSerif, not DejaVu Sans Mono'],
		2,
		[],
	]);
});
