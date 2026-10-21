// The layout samples: one slide for every built-in layout, with made-up demo data about a fictional team (Contoso) that
// ships an offline mode for its to-do app. `prs deck samples` builds it; look at out/contact.png to pick layouts, and
// copy the fields of a sample when you use its layout. The numbers are invented: a real deck sources every number.
const DEMO = ['Made-up demo data'];
const STILL = name => `assets/${name}.png`;

const openers = {
	id: 'openers', number: '01', title: 'Openers and big ideas', short: 'Openers',
	slides: [
		{
			id: 'title', layout: 'title',
			eyebrow: 'Layout samples  \u00b7  pr-studio',
			title: 'Shipping offline mode',
			quote: 'How the Contoso Tasks team built it, checked it and shipped it',
			speaker: { initials: 'CT', name: 'Contoso Tasks team', role: 'made-up demo data' },
			pills: [{ text: 'Demo deck', tone: 'blue' }, { text: 'October 2026', tone: 'neutral', icon: 'calendar' }],
			card: { label: 'Today', rows: 'blocks' },
			notes: 'The title slide. card.rows: \'blocks\' lists the sections with their minutes, computed by the build.',
		},
		{
			id: 'statement', layout: 'statement', eyebrow: 'The idea',
			text: 'Users don\u2019t care where the server is. {{blue|They care that their list is there.}}',
			chips: [{ icon: 'phone', text: 'On the train', tone: 'blue' }, { icon: 'cloud', text: 'No signal', tone: 'orange' }, { icon: 'checkmark', text: 'Still works', tone: 'green' }],
			notes: 'One big sentence, with one or two marked words.',
		},
		{
			id: 'hero', layout: 'hero', eyebrow: 'Why we built it', icon: 'phone', value: '1 in 3', tone: 'blue',
			label: 'support tickets were about losing edits without a connection', sub: 'beta survey', sources: DEMO,
			notes: 'One giant number or word.',
		},
		{
			id: 'quote', layout: 'quote', bg: 'blue', eyebrow: 'From the beta',
			text: 'I wrote my whole shopping list in the tunnel, and it was all still there when I got out.',
			who: { initials: 'AL', name: 'A beta tester', role: 'made-up demo quote' },
			notes: 'A quote, here on a blue page for rhythm. A real deck quotes real words, with a source.',
		},
		{
			id: 'counters', layout: 'counters', eyebrow: 'The beta', title: 'Three numbers from the beta',
			items: [
				{ value: '2,400', label: 'beta testers', sub: 'Android and iOS', tone: 'blue' },
				{ value: '98%', label: 'of edits synced', sub: 'within a minute of coming back online', tone: 'green' },
				{ value: '12', label: 'conflicts a day', sub: 'two people changed the same task', tone: 'orange' },
			],
			sources: DEMO, notes: 'One to three big numbers.',
		},
		{
			id: 'pillars', layout: 'pillars', eyebrow: 'The plan', title: 'Three things offline mode needs',
			items: [
				{ icon: 'database', title: 'Local storage', text: 'Lists live on the phone first.', example: 'A small database' },
				{ icon: 'sync', title: 'Sync', text: 'Edits go up once online.', example: 'A queue' },
				{ icon: 'merge', title: 'Conflicts', text: 'One rule for clashes.', example: 'Newest wins' },
			],
			notes: 'Two to four ideas side by side.',
		},
		{
			id: 'icons', layout: 'icons', eyebrow: 'In one line', title: 'Write, wait, sync',
			items: [
				{ icon: 'edit', title: 'Write', sub: 'on the phone', tone: 'blue' },
				{ icon: 'hourglass', title: 'Wait', sub: 'for a signal', tone: 'orange' },
				{ icon: 'sync', title: 'Sync', sub: 'in the background', tone: 'green' },
			],
			arrows: true, notes: 'Two to five big icons, a few words each.',
		},
		{
			id: 'checklist', layout: 'checklist', eyebrow: 'Before the release', title: 'Four checks before it ships',
			items: [
				{ icon: 'phone', tone: 'blue', title: 'Works in flight mode', sub: 'Android and iOS' },
				{ icon: 'sync', tone: 'green', title: 'Syncs within seconds' },
				{ icon: 'merge', tone: 'orange', title: 'Conflicts tell both people' },
				{ icon: 'history', tone: 'purple', title: 'A backup restores a list' },
			],
			notes: 'Three to five rows.',
		},
		{
			id: 'board', layout: 'board', eyebrow: 'Next steps', title: 'Now, next, later',
			columns: [
				{ title: 'Now', icon: 'flash', items: ['Fix the sync bug', { title: 'Write release notes', sub: 'for the store pages' }] },
				{ title: 'Next', icon: 'calendar', items: ['Offline search', 'Faster first sync'] },
				{ title: 'Later', icon: 'flag', items: ['Shared lists offline'] },
			],
			notes: 'Two to four columns of cards.',
		},
	],
};

const processes = {
	id: 'processes', number: '02', title: 'Processes and flows', short: 'Processes',
	slides: [
		{
			id: 'pipeline', layout: 'pipeline', eyebrow: 'How it works', title: 'An edit\u2019s way to the server',
			stages: [
				{ icon: 'edit', title: 'You edit', sub: 'Saved on the phone at once', tone: 'blue' },
				{ icon: 'list', title: 'It waits', sub: 'In a queue of edits', tone: 'orange' },
				{ icon: 'cloud', title: 'Back online', sub: 'The queue is sent', tone: 'purple' },
				{ icon: 'checkmark', title: 'Synced', sub: 'Every device sees it', tone: 'green', on: true },
			],
			loop: { from: 2, to: 1, label: 'retry if it fails' }, notes: 'Stages left to right, with a loop back.',
		},
		{
			id: 'steps', layout: 'steps', eyebrow: 'Try it', title: 'Test offline mode in four steps',
			steps: [
				{ title: 'Turn on flight mode' },
				{ title: 'Add three tasks' },
				{ title: 'Go online' },
				{ title: 'Open the web app' },
			],
			aside: { label: 'Copy-paste check', prompt: 'Test it offline, then online.' },
			notes: 'Numbered steps, with a card on the right.',
		},
		{
			id: 'sequence', layout: 'sequence', eyebrow: 'Under the hood', title: 'One edit, three parties',
			parties: [
				{ icon: 'phone', title: 'The phone', sub: 'the app', tone: 'blue' },
				{ icon: 'server', title: 'Sync service', sub: 'in the cloud', tone: 'purple' },
				{ icon: 'laptop', title: 'The web app', sub: 'another device', tone: 'green' },
			],
			steps: [
				{ from: 0, to: 1, text: 'Three queued edits' },
				{ from: 1, to: 0, text: 'Saved', reply: 'Next edit', replyTone: 'green' },
				{ from: 1, to: 2, text: 'Your list changed' },
			],
			notes: 'Messages between two to four parties.',
		},
		{
			id: 'journey', layout: 'journey', eyebrow: 'One task', title: 'A task travels from phone to laptop',
			nodes: [
				{ icon: 'phone', title: 'Phone', sub: 'Written offline' },
				{ icon: 'list', title: 'Queue', sub: 'Waits for a signal' },
				{ icon: 'cloud', title: 'Server', sub: 'Saved for good' },
				{ icon: 'laptop', title: 'Laptop', sub: 'Shows up there', result: 'synced', resultTone: 'green' },
			],
			hops: ['stored', 'sent', 'pushed'], packet: { text: 'Buy milk', icon: 'tasks' }, notes: 'One thing across three to five stops.',
		},
		{
			id: 'flow', layout: 'flow', eyebrow: 'Conflicts', title: 'What happens when two edits clash', cols: 4, rows: 2,
			nodes: [
				{ id: 'in', col: 0, row: 0, title: 'Edit arrives', icon: 'download', tone: 'blue' },
				{ id: 'q', col: 1, row: 0, title: 'Same task changed?', kind: 'decision' },
				{ id: 'save', col: 3, row: 0, title: 'Save it', icon: 'check', tone: 'green' },
				{ id: 'newest', col: 1, row: 1, title: 'Newest edit wins', sub: 'by the time it was made', icon: 'clock', tone: 'orange' },
				{ id: 'tell', col: 2, row: 1, title: 'Tell both people', sub: 'a small note in the app', icon: 'alert', tone: 'orange' },
			],
			edges: [
				{ from: 'in', to: 'q' },
				{ from: 'q', to: 'save', label: 'no', tone: 'green' },
				{ from: 'q', to: 'newest', label: 'yes', tone: 'orange' },
				{ from: 'newest', to: 'tell' },
				{ from: 'tell', to: 'save' },
			],
			notes: 'Boxes and arrows with a yes/no branch.',
		},
		{
			id: 'lanes', layout: 'lanes', eyebrow: 'Who does what', title: 'How a bug report becomes a fix',
			lanes: [{ id: 'people', title: 'People', icon: 'people', tone: 'green' }, { id: 'ai', title: 'AI', icon: 'bot', tone: 'purple' }],
			steps: [
				{ lane: 'people', icon: 'bug', title: 'A user reports it' },
				{ lane: 'ai', icon: 'search', title: 'A bot finds the cause' },
				{ lane: 'ai', icon: 'code', title: 'An agent drafts a fix' },
				{ lane: 'people', icon: 'checkmark', title: 'A person reviews it' },
				{ lane: null, icon: 'rocket', title: 'Next release' },
			],
			notes: 'Steps left to right in two or three lanes.',
		},
		{
			id: 'layers', layout: 'layers', eyebrow: 'The stack', title: 'Three layers keep your list safe',
			layers: [
				{ icon: 'phone', title: 'On the phone', sub: 'A copy of every list', tone: 'blue', chips: ['always'] },
				{ icon: 'cloud', title: 'In the cloud', sub: 'The copy devices sync to', tone: 'purple' },
				{ icon: 'history', title: 'Backups', sub: 'One a day', tone: 'green', callout: 'restores a list' },
			],
			notes: 'Two to five stacked bands.',
		},
		{
			id: 'bars', layout: 'bars', eyebrow: 'The beta', title: 'Lost edits fell week by week', unit: '%', max: 10,
			bars: [{ label: 'Week 1', value: 8.2 }, { label: 'Week 2', value: 4.1 }, { label: 'Week 3', value: 1.6 }, { label: 'Week 4', value: 0.4, on: true }],
			note: 'Share of offline edits that never reached the server.', sources: DEMO, notes: 'A bar chart; highlight the bar that matters.',
		},
	],
};

const stories = {
	id: 'stories', number: '05', title: 'Code, screens and stories', short: 'Stories',
	slides: [
		{
			id: 'split', layout: 'split', eyebrow: 'Writing the task', title: 'Brief the agent like a new colleague',
			left: { label: 'Vague', tone: 'red', icon: 'dismiss', prompt: 'make the app work offline', notes: ['Which parts?'] },
			right: { label: 'Briefed', tone: 'green', icon: 'checkmark', prompt: 'Queue edits offline, send them when back online. Newest edit wins.', notes: ['A rule for conflicts'] },
			verdict: { text: 'A better first try', tone: 'green', icon: 'sparkle' },
			notes: 'Before and after, or weak and strong.',
		},
		{
			id: 'matrix', layout: 'matrix', eyebrow: 'The options', title: 'Three ways to store lists on the phone',
			columns: [{ label: 'Option', width: '1.5fr' }, { label: 'Fast', width: '1fr' }, { label: 'Small', width: '1fr' }, { label: 'Easy to sync', width: '1fr' }],
			rows: [
				['Plain files', { ok: true, text: 'yes' }, { ok: true, text: 'yes' }, { ok: false, text: 'no' }],
				['Key-value store', { ok: true, text: 'yes' }, { ok: true, text: 'yes' }, { ok: false, text: 'partly' }],
				{ cells: ['Small database', { ok: true, text: 'yes' }, { ok: false, text: 'larger' }, { ok: true, text: 'yes' }], tone: 'green' },
			],
			note: 'We picked the small database.', notes: 'A table; tint the row that wins.',
		},
		{
			id: 'code', layout: 'code', annotate: true, eyebrow: 'The conflict rule', title: 'The rule fits in six lines', lang: 'ts', file: 'src/sync/merge.ts',
			code: 'function merge(mine: Task, theirs: Task) {\n\tif (mine.at === theirs.at) {\n\t\treturn theirs;\n\t}\n\treturn mine.at > theirs.at ? mine : theirs;\n}',
			callouts: [{ lines: [2, 3], title: 'A tie', text: 'the server\u2019s copy wins' }, { lines: [5, 5], title: 'Otherwise', text: 'the newest edit wins' }],
			notes: 'Code with notes joined to its lines.',
		},
		{
			id: 'chat', layout: 'chat', eyebrow: 'Working with an agent', title: 'It says what it changed, and why', dark: true, window: 'Chat',
			messages: [
				{ from: 'user', text: 'Offline edits sometimes vanish. Why?' },
				{ from: 'agent', text: 'The queue was cleared too early. It now waits for **saved**, with a test.' },
			],
			notes: 'A conversation, light or dark.',
		},
		{
			id: 'ui', layout: 'ui', eyebrow: 'Working with an agent', title: 'You approve the risky step',
			window: { title: 'Chat', width: 1000, blocks: [
				{ kind: 'user', text: 'Add a database migration' },
				{ kind: 'tool', icon: 'edit', text: 'Edited migrate.ts  +31 \u22122', status: 'done' },
				{ kind: 'approve', text: 'Run this command?', cmd: 'npm run migrate', buttons: ['Allow', 'Skip'] },
			] },
			callouts: [{ title: 'Reading is free' }, { title: 'Commands ask first', tone: 'orange' }],
			notes: 'A mock chat window with tool calls and an approval.',
		},
		{
			id: 'files', layout: 'files', eyebrow: 'The code', title: 'Where offline mode lives', root: 'contoso-tasks',
			items: [
				{ path: 'src/storage/', title: 'Local database', text: 'every list, on the device', icon: 'database', tone: 'blue' },
				{ path: 'src/sync/queue.ts', title: 'The edit queue', text: 'waits for a signal', icon: 'list', tone: 'orange' },
				{ path: 'src/sync/merge.ts', title: 'The conflict rule', text: 'newest edit wins', icon: 'merge', tone: 'green' },
				{ path: 'test/' },
			],
			notes: 'A folder tree with explained files.',
		},
		{
			id: 'image', layout: 'image', eyebrow: 'A picture', title: 'A screenshot: crop, pin, ring', src: STILL('code.diff'), alt: 'A code diff', crop: [44, 114, 592, 230], width: 1060,
			callouts: [{ title: 'Crop it', text: 'Only the part people need.' }, { title: 'Pin it', text: 'A number beside the spot.', at: [282, 205] }, { title: 'Ring it', text: 'A region, outlined.', box: [118, 288, 292, 16] }],
			notes: 'A screenshot from the deck\u2019s assets, cropped, with a callout pinned where it points (at: [x, y]) and one ringing a region (box: [x, y, w, h]), in the picture\u2019s own pixels.',
		},
		{
			id: 'spans', layout: 'spans', eyebrow: 'A lifecycle', title: 'Offline edits outlive the connection',
			moments: [{ title: 'Edit offline' }, { title: 'Back online', sub: 'the queue sends' }, { title: 'Server agrees' }, { title: 'App closes' }],
			rows: [
				{ title: 'Connection', tone: 'blue', bars: [{ from: 1, to: 3 }] },
				{ title: 'Queued edit', tone: 'orange', bars: [{ from: 0, to: 2, text: 'waits for the server' }] },
				{ title: 'Edit on screen', tone: 'green', bars: [{ from: 0, to: 3, text: 'shown all along', solid: true }] },
			],
			notes: 'What lives how long: a row per piece of state, a bar while it holds, between a few moments.', nosrc: true,
		},
		{
			id: 'split-pictures', layout: 'split', eyebrow: 'Before and after', title: 'Two crops of one screen, ringed',
			left: { label: 'Before', tone: 'red', icon: 'dismiss', title: 'Checked after the read', image: STILL('code.diff'), crop: [44, 114, 380, 230], box: [118, 197, 112, 16] },
			right: { label: 'After', tone: 'green', icon: 'checkmark', title: 'Checked first', image: STILL('code.diff'), crop: [44, 114, 380, 230], box: [118, 212, 246, 16] },
			verdict: { text: 'Crop both the same, ring what changed', tone: 'blue', icon: 'info' },
			notes: 'A split side can hold a picture: crop the before and after screenshots to the same region, and ring what changed (box: [x, y, w, h] in the picture\u2019s own pixels).',
		},
		{
			id: 'howto', layout: 'howto', eyebrow: 'For new users', title: 'Turn on offline mode',
			steps: [
				{ title: 'Open the commands', ui: { keys: ['F1'], alts: [{ label: 'Mac', keys: ['\u21e7', '\u2318', 'P'] }] } },
				{ title: 'Find the setting', ui: { palette: 'offline', items: ['Tasks: Turn On Offline Mode'] } },
				{ title: 'Pick your lists', tone: 'green', ui: { prompt: 'Which lists should work offline?', list: ['All lists', 'Only starred lists'], pick: 0 } },
			],
			note: 'Then go offline and try it', notes: 'How to do it in an app, with keys and small screens.',
		},
		{
			id: 'statement-dark', layout: 'statement', bg: 'dark', eyebrow: 'The lesson',
			text: 'Fast is easy to ship. {{blue|Trustworthy takes a check.}}', notes: 'A statement on a dark page, for rhythm.',
		},
		{
			id: 'build', layout: 'samples-build', eyebrow: 'A custom design', title: 'A slide that builds up, click by click',
			cards: [
				{ icon: 'edit', title: 'Write it', text: 'Saved on the phone', tone: 'blue' },
				{ icon: 'list', title: 'Queue it', text: 'Waits for a signal', tone: 'orange' },
				{ icon: 'sync', title: 'Sync it', text: 'Every device sees it', tone: 'green' },
			],
			clicks: [
				{ caption: 'First, the edit is saved on the phone.', say: 'Nothing leaves the phone yet.' },
				{ caption: 'Then it waits in a queue.', say: 'The queue survives a restart.' },
				{ caption: 'Back online, it syncs.', say: 'Every device sees the change.' },
			],
			notes: 'Drawn by designs/samples.mjs: one PDF page per click.',
		},
		{
			id: 'end', layout: 'end', title: 'Questions?', url: 'https://github.com/federicobrancasi/pr-studio', meta: 'pr-studio  \u00b7  layout samples',
			notes: 'The end card, with a link and its QR code.',
		},
	],
};

export default {
	title: 'Layout samples',
	ref: 'pr-studio  \u00b7  layout samples (made-up demo data)',
	sections: [openers, processes, stories],
};
