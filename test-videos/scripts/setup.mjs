// First-run setup for the test-videos plugin: checks the Mac and installs what the kit needs into its cache folder
// (~/.cache/test-videos, or TEST_VIDEOS_HOME). Safe to run again: it only adds what is missing.
//
//   node <plugin>/scripts/setup.mjs            check and install
//   node <plugin>/scripts/setup.mjs --check    check only, install nothing
//
// Installs: playwright-core (no browser: the kit drives the installed VS Code Insiders through Electron), a Python
// environment from requirements.txt (the Kokoro voice, Whisper, a bundled ffmpeg, Pillow), the Kokoro model files and
// the Whisper model. About 400 MB. The last lines print KIT=, PY=, WORK= and DELIVERY= for the skill to use.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.join(SCRIPTS, 'kit');
const CACHE = process.env.TEST_VIDEOS_HOME ?? path.join(os.homedir(), '.cache/test-videos');
const DELIVERY = process.env.TEST_VIDEOS_DELIVERY ?? path.join(os.homedir(), 'Downloads/test-videos');
const INSIDERS = '/Applications/Visual Studio Code - Insiders.app';
const PLAYWRIGHT = '1.63.0';
const KOKORO = {
	'kokoro-v1.0.int8.onnx': 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx',
	'voices-v1.0.bin': 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin',
};
const DEFAULT_CONFIG = { voice: { provider: 'auto', mai: { voice: 'en-US-Grant:MAI-Voice-2', region: 'eastus2' }, kokoro: { voice: 'am_michael', speed: 1.0 } } };
const checkOnly = process.argv.includes('--check');

let problems = 0;
const ok = m => console.log(`  \u2713 ${m}`);
const warn = m => console.log(`  ! ${m}`);
const fail = m => { console.log(`  \u2717 ${m}`); problems++; };
const has = cmd => spawnSync('/usr/bin/which', [cmd], { encoding: 'utf8' }).status === 0;
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function findPython() {
	for (const c of ['/opt/homebrew/bin/python3.12', '/opt/homebrew/bin/python3.11', '/opt/homebrew/bin/python3.13', '/opt/homebrew/bin/python3.10', '/usr/local/bin/python3.12', '/usr/local/bin/python3.11', 'python3.12', 'python3.11', 'python3.13', 'python3.10', 'python3']) {
		const r = spawnSync(c, ['-c', 'import sys; print(sys.version_info[:2] >= (3, 10) and sys.version_info[:2] < (3, 14))'], { encoding: 'utf8' });
		if (r.status === 0 && r.stdout.trim() === 'True') {
			return c;
		}
	}
	return null;
}

async function download(url, file) {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`download failed (${res.status}): ${url}`);
	}
	fs.writeFileSync(`${file}.part`, Buffer.from(await res.arrayBuffer()));
	fs.renameSync(`${file}.part`, file);
}

async function main() {
	console.log(`test-videos setup${checkOnly ? ' (check only)' : ''}: ${CACHE}`);

	// The Mac.
	process.platform === 'darwin' ? ok(`macOS ${os.release()}`) : fail('macOS only for now: the kit links the macOS keychain and runs the Insiders app');
	Number(process.versions.node.split('.')[0]) >= 20 ? ok(`node ${process.versions.node}`) : fail(`node ${process.versions.node}: needs 20 or newer`);
	const product = path.join(INSIDERS, 'Contents/Resources/app/product.json');
	if (fs.existsSync(product)) {
		const p = JSON.parse(fs.readFileSync(product, 'utf8'));
		ok(`VS Code Insiders ${p.version} (${p.commit.slice(0, 10)}, ${p.date?.slice(0, 10)})`);
	} else {
		warn(`VS Code Insiders not found in /Applications: install it, or pass --build <app> to run.mjs`);
	}
	has('sqlite3') ? ok('sqlite3 (copies the Insiders sign-in into a throwaway profile)') : fail('sqlite3 not found');
	if (!has('gh')) {
		warn('gh not found: the skill reads the TPI or issue and its PRs with it (brew install gh, then gh auth login)');
	} else {
		spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' }).status === 0 ? ok('gh, signed in') : warn('gh is not signed in (gh auth login)');
	}

	if (!checkOnly) {
		fs.mkdirSync(CACHE, { recursive: true });
	}

	// playwright-core, in the cache with its own package.json, so the plugin needs nothing from the team kit's root.
	const pw = path.join(CACHE, 'node_modules/playwright-core/package.json');
	const pwVersion = fs.existsSync(pw) ? JSON.parse(fs.readFileSync(pw, 'utf8')).version : null;
	if (pwVersion !== PLAYWRIGHT) {
		if (checkOnly) {
			fail(`playwright-core ${PLAYWRIGHT} not installed`);
		} else {
			console.log(`  installing playwright-core ${PLAYWRIGHT}...`);
			fs.writeFileSync(path.join(CACHE, 'package.json'), JSON.stringify({ private: true, description: 'test-videos plugin cache', dependencies: { 'playwright-core': PLAYWRIGHT } }, null, 1));
			execFileSync('npm', ['install', '--silent', '--no-audit', '--no-fund'], { cwd: CACHE, stdio: 'inherit' });
		}
	}
	if (fs.existsSync(pw)) {
		ok(`playwright-core ${JSON.parse(fs.readFileSync(pw, 'utf8')).version} (no browser needed)`);
	}

	// The Python environment: voice, Whisper, ffmpeg, Pillow.
	const venv = path.join(CACHE, 'venv');
	const py = path.join(venv, 'bin', 'python');
	if (!fs.existsSync(py)) {
		const base = findPython();
		if (!base) {
			fail('Python 3.10-3.13 not found (brew install python@3.12)');
		} else if (checkOnly) {
			fail(`Python environment not created (would use ${base})`);
		} else {
			console.log(`  creating the Python environment with ${base}...`);
			execFileSync(base, ['-m', 'venv', venv], { stdio: 'inherit' });
		}
	}
	if (fs.existsSync(py)) {
		const requirements = path.join(SCRIPTS, 'requirements.txt');
		const stamp = path.join(venv, '.test-videos-requirements');
		const installed = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').trim() : '';
		const imports = spawnSync(py, ['-c', 'import kokoro_onnx, faster_whisper, soundfile, numpy, imageio_ffmpeg, PIL, av'], { encoding: 'utf8' });
		if (imports.status !== 0 || installed !== sha256(requirements)) {
			if (checkOnly) {
				fail('Python packages missing or out of date (requirements.txt)');
			} else {
				console.log('  installing Python packages (requirements.txt)...');
				execFileSync(py, ['-m', 'pip', 'install', '-q', '--upgrade', 'pip'], { stdio: 'inherit' });
				execFileSync(py, ['-m', 'pip', 'install', '-q', '-r', requirements], { stdio: 'inherit' });
				fs.writeFileSync(stamp, sha256(requirements));
			}
		}
		if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === sha256(requirements)) {
			ok('Python environment (Kokoro, Whisper, Pillow)');
			const bin = path.join(CACHE, 'bin', 'ffmpeg');
			if (!fs.existsSync(bin) && !checkOnly) {
				const exe = execFileSync(py, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim();
				fs.mkdirSync(path.dirname(bin), { recursive: true });
				fs.symlinkSync(exe, bin);
			}
			fs.existsSync(bin) ? ok(`ffmpeg (${fs.realpathSync(bin)})`) : fail('ffmpeg not linked');
			const kdir = path.join(CACHE, 'kokoro');
			for (const [name, url] of Object.entries(KOKORO)) {
				if (!fs.existsSync(path.join(kdir, name)) && !checkOnly) {
					fs.mkdirSync(kdir, { recursive: true });
					console.log(`  downloading ${name}...`);
					await download(url, path.join(kdir, name));
				}
			}
			Object.keys(KOKORO).every(n => fs.existsSync(path.join(kdir, n))) ? ok('Kokoro voice model (Apache-2.0)') : fail('Kokoro voice model missing');
			if (!checkOnly) {
				const w = spawnSync(py, ['-c', 'from faster_whisper import WhisperModel; WhisperModel("small.en", compute_type="int8")'], { encoding: 'utf8', env: { ...process.env, HF_HUB_DISABLE_TELEMETRY: '1' } });
				w.status === 0 ? ok('Whisper small.en (word timing and the listener check)') : fail(`Whisper model: ${w.stderr.trim().split('\n').at(-1)}`);
			}
		}
	}

	// Settings: the voice. MAI-Voice-2 with an Azure Speech key, else Kokoro (offline, free).
	const configFile = path.join(CACHE, 'config.json');
	if (!fs.existsSync(configFile) && !checkOnly) {
		fs.writeFileSync(configFile, JSON.stringify(DEFAULT_CONFIG, null, 1));
	}
	const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : DEFAULT_CONFIG;
	if (process.env.AZURE_SPEECH_KEY) {
		ok('voice: MAI-Voice-2 (AZURE_SPEECH_KEY)');
	} else if (config.voice?.mai?.azResource) {
		ok(`voice: MAI-Voice-2 via an az lookup of ${config.voice.mai.azResource}, Kokoro when that fails`);
	} else {
		ok(`voice: Kokoro (offline). For MAI-Voice-2, set AZURE_SPEECH_KEY, or voice.mai.azResource and azResourceGroup in ${configFile}`);
	}

	if (!checkOnly) {
		fs.mkdirSync(path.join(CACHE, 'work'), { recursive: true });
		fs.mkdirSync(DELIVERY, { recursive: true });
	}
	console.log(problems ? `${problems} problem(s): ${checkOnly ? 'run this again without --check to install what is missing, then fix the rest' : 'fix them and run this again'}.` : 'ready');
	console.log(`KIT=${KIT}`);
	console.log(`PY=${py}`);
	console.log(`WORK=${path.join(CACHE, 'work')}`);
	console.log(`DELIVERY=${DELIVERY}`);
	process.exitCode = problems ? 1 : 0;
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
