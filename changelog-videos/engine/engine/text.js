// Where on-screen text comes from. Pure (no DOM): imported both by Node (prs prepare verifies every reference
// against the PR before anything renders) and by the browser (which resolves them to strings).
//
//   label('The fix')                         microcopy written by the agent (the reviewer checks it)
//   fact('additions', { format: 'n' })       a value from pr.json facts, never retyped
//   quote('contact your administrator')      an exact substring of the PR body, diff, tests, title or commits
//   ident('isSameSecureOrigin')              an identifier that appears in the PR's diff or changed files
//   path('src/vs/.../file.ts')               a file the PR changes (shown as basename by default)
//   code('src/vs/.../file.ts', { from, to }) source lines at the PR head commit (tokenized at prepare time)
//
// Arrays combine parts: [fact('changedFiles'), label(' files')]. Plain strings are labels.

export const label = (text, opts = {}) => ({ $text: 'label', text: String(text), ...opts });
export const fact = (path, opts = {}) => ({ $text: 'fact', path, format: opts.format, prefix: opts.prefix ?? '', suffix: opts.suffix ?? '' });
export const quote = (text, opts = {}) => ({ $text: 'quote', text: String(text), where: opts.in ?? 'any' });
export const ident = name => ({ $text: 'ident', text: String(name) });
export const path = (filePath, opts = {}) => ({ $text: 'path', path: String(filePath), show: opts.show ?? 'basename' });
export const code = (file, selection = {}) => ({ $code: true, file: String(file), ...selection });

export function isText(value) {
	return !!value && typeof value === 'object' && typeof value.$text === 'string';
}

export function isCode(value) {
	return !!value && typeof value === 'object' && value.$code === true;
}

/** Stable key for a code reference (Node and browser compute the same one); every option is part of it. */
export function codeKey(ref) {
	return JSON.stringify(Object.keys(ref).filter(k => k !== '$code').sort().map(k => [k, ref[k]]));
}

export function getPath(root, dotted) {
	let current = root;
	for (const part of String(dotted).split('.')) {
		if (current === null || current === undefined || !Object.hasOwn(Object(current), part)) {
			return undefined;
		}
		current = current[part];
	}
	return current;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatFact(value, format) {
	if (value === undefined || value === null) {
		return '';
	}
	switch (format) {
		case 'n':
			return Number(value).toLocaleString('en-US');
		case 'date': {
			const d = new Date(value);
			return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
		}
		case 'lower':
			return String(value).toLowerCase();
		case 'state':
			return { OPEN: 'Open', MERGED: 'Merged', CLOSED: 'Closed' }[value] ?? String(value);
		case 'review':
			return { REVIEW_REQUIRED: 'Review required', APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested' }[value] ?? String(value).toLowerCase().replace(/_/g, ' ');
		default:
			return String(value);
	}
}

function basename(p) {
	return p.split('/').pop();
}

/** -> { text, src } for one part. src goes into data-src so the linter can see where every string came from. */
export function resolvePart(value, facts) {
	if (value === null || value === undefined) {
		return { text: '', src: 'label' };
	}
	if (isCode(value)) {
		throw new Error(`code('${value.file}') is not text: show a file with path('${value.file}') or a name with ident('...'); code() goes in params that take code`);
	}
	if (!isText(value)) {
		if (typeof value === 'object') {
			throw new Error(`not text: ${JSON.stringify(value).slice(0, 80)}. Use label(), fact(), quote(), ident() or path()`);
		}
		return { text: String(value), src: 'label' };
	}
	switch (value.$text) {
		case 'label':
			return { text: value.text, src: 'label' };
		case 'fact': {
			const raw = getPath(facts ?? {}, value.path);
			if (raw === undefined) {
				throw new Error(`fact('${value.path}') is not in pr.json facts`);
			}
			return { text: `${value.prefix}${formatFact(raw, value.format)}${value.suffix}`, src: `fact:${value.path}` };
		}
		case 'quote':
			return { text: value.text, src: `quote:${value.where}` };
		case 'ident':
			return { text: value.text, src: 'ident' };
		case 'path': {
			const parts = value.path.split('/');
			const shown = value.show === 'full' ? value.path
				: value.show === 'dir' ? parts.slice(0, -1).join('/')
					: value.show === 'tail2' ? parts.slice(-2).join('/')
						: basename(value.path);
			return { text: shown, src: 'path' };
		}
		default:
			throw new Error(`Unknown text kind ${value.$text}`);
	}
}

/** Flattens a text value (part or array of parts) into parts. */
export function textParts(value, facts) {
	const list = Array.isArray(value) ? value : [value];
	return list.map(part => resolvePart(part, facts));
}

export function textOf(value, facts) {
	return textParts(value, facts).map(part => part.text).join('');
}

/** Walks any params object and yields every text and code reference (used by prs prepare). */
export function* walkRefs(value, trail = '') {
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) {
			yield* walkRefs(value[i], `${trail}[${i}]`);
		}
		return;
	}
	if (!value || typeof value !== 'object') {
		return;
	}
	if (isText(value) || isCode(value)) {
		yield { ref: value, trail };
		return;
	}
	for (const [key, child] of Object.entries(value)) {
		if (key === 'impl') {
			continue;
		}
		yield* walkRefs(child, trail ? `${trail}.${key}` : key);
	}
}
