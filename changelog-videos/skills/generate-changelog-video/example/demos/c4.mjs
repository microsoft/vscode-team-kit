// c4 · #341230: in Agent Host chats, /fork now takes a title (/fork <title>) or a prompt (/fork prompt <prompt>). Setup
// makes a session with one short reply (a fork needs a turn), then the recording types /fork and forks with a title.
export async function setup({ openAgentsWindow, sleep }) {
	const agents = await openAgentsWindow();
	await agents.chat.send('Suggest a one-line tagline for a to-do list app. Reply with the tagline only.');
	await agents.chat.reply();
	await sleep(1500);
}

export default async function demo({ page, chat, click, type, press, mark, step, sleep, cue }) {
	const suggestion = label => page.locator('.suggest-widget .monaco-list-row').filter({ visible: true }).filter({ hasText: label }).first();
	const forked = page.locator('.monaco-list-row').filter({ visible: true }).filter({ hasText: 'Shorter tagline' }).first();
	mark('title', suggestion('/fork <title>'), { text: 'Fork conversation with a custom title' });
	mark('prompt', suggestion('/fork prompt'), { text: 'Fork conversation and send a prompt' });
	mark('forked', forked);
	await sleep(600);
	await click(chat.input());
	await cue('slash fork');
	await type('/fork', { delay: 80 });
	await suggestion('/fork prompt').waitFor({ state: 'visible', timeout: 10_000 });
	step('suggestions');
	// The menu stays up a second after "or a title" (its arrow), then the title is typed and sent.
	await cue('or a title', { offset: 1.3 });
	await type(' Shorter tagline', { delay: 35 });
	await sleep(150);
	await press('Enter');
	await forked.waitFor({ state: 'visible', timeout: 30_000 });
	step('forked');
	await sleep(1500);
}
