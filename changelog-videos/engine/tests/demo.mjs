// prs demo: the environment VS Code gets inside a sandbox (gh-aw's agent firewall) on Linux, and its windows on a Mac.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fontConfig, fontProblems, hiddenWindows, prepareLinuxEnv, removeStaleProfiles, signInAdvice, signInSource, signInState, userDataRoot, usesBasicPasswordStore } from '../cli/lib/demo.mjs';

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

test('on a Mac, VS Code\'s windows are invisible unless PRS_SHOW_WINDOW=1; Linux records on a virtual display', () => {
	assert.deepStrictEqual(
		[hiddenWindows('darwin', {}), hiddenWindows('darwin', { PRS_SHOW_WINDOW: '1' }), hiddenWindows('linux', {})],
		[true, false, false]);
});

test('the sign-in state of a build, and what to tell the user when it can\'t record chat or the Agents window', () => {
	const insiders = { profile: 'Code - Insiders', args: [], argv: '/home/me/.vscode-insiders/argv.json' };
	const main = { profile: 'Code OSS', args: ['/builds/vscode-1964d141f'] };
	assert.deepStrictEqual([
		[signInState(), signInState({ profile: false }), signInState({ expired: true, signInButton: true }), signInState({ signInButton: true })],
		signInAdvice('signed-in', insiders),
		signInAdvice('signed-out', insiders),
		signInAdvice('expired', main),
		signInAdvice('no-profile', insiders, 'darwin'),
		signInAdvice('no-profile', insiders, 'linux'),
		signInAdvice('no-basic-store', insiders, 'linux'),
	], [
		['signed-in', 'no-profile', 'expired', 'signed-out'],
		null,
		'VS Code Insiders isn\'t signed in to GitHub, so chat and the Agents window can\'t be recorded. Sign in to GitHub in VS Code Insiders (the Accounts menu), then run prs demo check again',
		'Code OSS\'s GitHub sign-in has expired, so chat and the Agents window can\'t be recorded. Sign in to GitHub in that build (start it with /builds/vscode-1964d141f/scripts/code.sh), then run prs demo check again',
		'VS Code Insiders was never started on this Mac, so chat and the Agents window can\'t be recorded. Sign in to GitHub in VS Code Insiders (the Accounts menu), then run prs demo check again',
		'VS Code Insiders was never started on this machine, so chat and the Agents window can\'t be recorded. Sign in to GitHub in VS Code Insiders (the Accounts menu), then run prs demo check again',
		'VS Code Insiders keeps its GitHub sign-in in the system keyring, which a copy of its profile can\'t read, so chat and the Agents window can\'t be recorded. Add "password-store": "basic" to /home/me/.vscode-insiders/argv.json, sign in to GitHub again in VS Code Insiders (the Accounts menu), then run prs demo check again',
	]);
});

test('a signed-in profile is copied on a Mac, and on Linux only when it keeps its secrets with basic encryption', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'prs-signin-test-'));
	try {
		const state = path.join(tmp, 'state.vscdb');
		const basic = path.join(tmp, 'basic.json');
		const keyring = path.join(tmp, 'keyring.json');
		const commented = path.join(tmp, 'commented.json');
		fs.writeFileSync(state, '');
		fs.writeFileSync(basic, '// VS Code\'s runtime arguments\n{\n\t"enable-crash-reporter": true,\n\t"password-store": "basic"\n}\n');
		fs.writeFileSync(keyring, '{\n\t"password-store": "gnome-libsecret"\n}\n');
		fs.writeFileSync(commented, '{\n\t// "password-store": "basic"\n}\n');
		const spec = argv => ({ state, argv });
		assert.deepStrictEqual([
			[usesBasicPasswordStore(basic), usesBasicPasswordStore(keyring), usesBasicPasswordStore(commented), usesBasicPasswordStore(path.join(tmp, 'none.json'))],
			signInSource(spec(keyring), 'darwin'),
			signInSource(spec(basic), 'linux'),
			signInSource(spec(keyring), 'linux'),
			signInSource({ state: path.join(tmp, 'missing.vscdb'), argv: basic }, 'linux'),
			signInSource(spec(basic), 'win32'),
		], [[true, false, false, false], 'ok', 'ok', 'no-basic-store', 'no-profile', 'unsupported']);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});

test('VS Code\'s profiles live in Application Support on a Mac, and in XDG_CONFIG_HOME or ~/.config on Linux', () => {
	assert.deepStrictEqual([
		userDataRoot('darwin', {}, '/Users/me'),
		userDataRoot('linux', {}, '/home/me'),
		userDataRoot('linux', { XDG_CONFIG_HOME: '/home/me/.cfg' }, '/home/me'),
	], ['/Users/me/Library/Application Support', '/home/me/.config', '/home/me/.cfg']);
});

test('throwaway profiles that interrupted runs left behind (a copy of the user\'s sign-in) go after 6 hours; others stay', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prs-stale-test-'));
	try {
		const now = Date.now();
		for (const [name, hoursAgo] of [['prs-demo-old', 7], ['prs-demo-running', 1], ['not-ours', 30]]) {
			fs.mkdirSync(path.join(dir, name, 'user-data'), { recursive: true });
			const t = new Date(now - hoursAgo * 3600 * 1000);
			fs.utimesSync(path.join(dir, name), t, t);
		}
		removeStaleProfiles(dir, now);
		assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['not-ours', 'prs-demo-running']);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});
