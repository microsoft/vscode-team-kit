// Per-user configuration for My Work, shared with skills/my-issues/scripts/my_issues.py.
// Users override any field in <COPILOT_HOME>/project-boards/my-work.config.json; everything else
// falls back to defaults that suit the VS Code team. Never put team-private details in the defaults:
// this package is public.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const COPILOT_HOME = process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot');
export const BOARD = path.join(COPILOT_HOME, 'project-boards');
export const CONFIG_FILE = path.join(BOARD, 'my-work.config.json');

const here = path.dirname(fileURLToPath(import.meta.url));
// <plugin>/com.github.copilot/extensions/my-work/lib → <plugin>/skills/my-issues/scripts/my_issues.py
export const SCRIPT = process.env.MY_WORK_SCRIPT || path.resolve(here, '..', '..', '..', '..', 'skills', 'my-issues', 'scripts', 'my_issues.py');
// Baseline triage principles shipped with the plugin; the user's rules refine them.
export const PRINCIPLES = path.resolve(path.dirname(SCRIPT), '..', 'triage-principles.md');

export const DEFAULTS = Object.freeze({
	// GitHub org whose issues are indexed and searched.
	org: 'microsoft',
	// Repository whose milestones define "current" and "next" in My Work.
	planRepo: 'microsoft/vscode',
	// Local clones used for fix sessions and read-only investigations, by repository.
	repoPaths: { 'microsoft/vscode': '~/work/vscode' },
	// Optional local clone of the Sweeper state repo: a faster, offline source for review records.
	sweeperRepo: '~/work/vscodesweeper-state',
	// The Sweeper's published state repo (index and records, read with gh); empty turns Sweeper data off.
	sweeperStateRepo: 'egamma/vscodesweeper-state',
	// Inbox rules shared with the github-inbox plugin.
	rulesFile: path.join(COPILOT_HOME, 'github-inbox-rules.md'),
	// Inbox memory shared with the github-inbox plugin: people, GitHub logins, owners, teams, preferences.
	memoryFile: path.join(COPILOT_HOME, 'github-inbox-memory.md'),
	// Private My Work data: pinned sessions, custom sections and their notes, the My Work chat link.
	dataDir: '~/.agents/data/my-work',
	// Skill fix sessions use for bugs, e.g. a personal "fix-vscode-bug" skill; empty = none.
	fixSkill: '',
	// Skill review sessions use for pull requests, e.g. a personal code review skill; empty = none.
	reviewSkill: '',
});

let cache = { mtimeMs: -1, value: DEFAULTS };

/** The effective configuration (defaults overlaid with the user's file), re-read when the file changes. */
export function config() {
	let mtimeMs = 0;
	try { mtimeMs = statSync(CONFIG_FILE).mtimeMs; } catch { /* no user config */ }
	if (mtimeMs === cache.mtimeMs) return cache.value;
	let user = {};
	if (mtimeMs) {
		try { user = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch { user = {}; }
	}
	const value = {
		...DEFAULTS, ...user,
		repoPaths: { ...DEFAULTS.repoPaths, ...(user.repoPaths || {}) },
	};
	cache = { mtimeMs, value };
	return value;
}

export function expandHome(p) {
	return typeof p === 'string' && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

/** Configured local clones that exist on this machine (missing defaults are ignored). */
function clones() {
	return Object.entries(config().repoPaths).filter(([, p]) => p && existsSync(expandHome(p)));
}

/** Display form of a repository's local clone for prompts, or null when none exists. */
export function repoPath(repo) {
	return clones().find(([r]) => r === repo)?.[1] || null;
}

export function dataDir() {
	return expandHome(config().dataDir);
}

/** Prompt text telling the chat where a repository lives locally. */
export function repoHint(repo = config().planRepo) {
	const paths = clones().map(([r, p]) => `${r} → ${p}`).join(', ');
	return paths ? `local clones: ${paths}` : `no local clones are configured; ask before cloning ${repo}`;
}

/** Prompt text telling a chat which triage principles, rules and memory to use. */
export function rulesHint() {
	const c = config();
	return `Apply the general triage principles (${PRINCIPLES}) and my inbox rules (${c.rulesFile}; they win over the principles and may not exist yet), and use my memory (${c.memoryFile}) for people, GitHub logins, owners and teams`;
}

// On Windows `python3` is often the Microsoft Store alias, which exists but only prints "Python was not found".
const PYTHON_CANDIDATES = process.platform === 'win32' ? [['python3'], ['python'], ['py', '-3']] : [['python3'], ['python']];
const PYTHON_CHECK = 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)';
const runsPython = ([cmd, ...args]) => spawnSync(cmd, [...args, '-c', PYTHON_CHECK], { stdio: 'ignore', timeout: 10_000, windowsHide: true }).status === 0;

/** The first candidate (command and leading args) that really runs Python 3.9+, or null if none does. */
export function findPython(candidates = PYTHON_CANDIDATES) {
	return candidates.find(runsPython) ?? null;
}
let pythonCmd;
/** The Python command used to run the helper scripts, or null if none works. Only a working one is kept, so Python installed while the panel runs is picked up. */
export function python() {
	pythonCmd ??= findPython() ?? undefined;
	return pythonCmd ?? null;
}
export const PYTHON_MISSING = `Python 3.9+ was not found (tried ${PYTHON_CANDIDATES.map(c => c.join(' ')).join(', ')}); install it, then refresh`;

// Where installers put gh. A chat or panel started before gh was installed has a PATH without it,
// which used to need a VS Code restart.
function ghDirs(env) {
	if (process.platform === 'win32') {
		return [
			env.ProgramFiles && path.join(env.ProgramFiles, 'GitHub CLI'),
			env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'GitHub CLI'),
			env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'GitHub CLI'),
			env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'),
		].filter(Boolean);
	}
	return ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/home/linuxbrew/.linuxbrew/bin', path.join(os.homedir(), '.local', 'bin')];
}
/** Adds gh's install folder to PATH when gh is installed but not on PATH; returns whether gh is reachable. */
export function ensureGhOnPath(env = process.env, dirs = ghDirs(env)) {
	const exe = process.platform === 'win32' ? 'gh.exe' : 'gh';
	const onPath = (env.PATH || '').split(path.delimiter).filter(Boolean);
	if (onPath.some(d => existsSync(path.join(d, exe)))) return true;
	const dir = dirs.find(d => existsSync(path.join(d, exe)));
	if (dir) env.PATH = [dir, ...onPath].join(path.delimiter);
	return !!dir;
}

/** The command prefix chats use to run the helper script. */
export function scriptCommand() {
	return `${(python() ?? PYTHON_CANDIDATES[0]).join(' ')} "${SCRIPT}"`;
}
