// The setup's self-test (node scripts/setup.mjs --selftest): a tiny signed-out video that exercises every stage on
// this Mac. Quick Open a file by pasting its name, then click another one in the Explorer; each result is checked.
export default {
	signedIn: false,
	agents: false,
	workspace: { name: 'selftest', files: { 'README.md': '# Self-test\n' }, commits: [{ message: 'Add notes', files: { 'notes.md': 'hello\n' }, daysAgo: 2 }] },
	steps: [
		{
			id: 'prepare', hidden: true, async run(ctx) {
				await ctx.page.locator('.monaco-workbench').waitFor({ timeout: 60000 });
				await ctx.page.getByRole('treeitem', { name: /README\.md/ }).waitFor({ timeout: 30000 });
				await ctx.page.waitForTimeout(1000);
				return 'the workbench and the Explorer are ready';
			},
		},
		{
			id: 'open', async run(ctx) {
				await ctx.at(ctx.cue('Quick') - 0.2);
				await ctx.h.press('Meta+P');
				await ctx.page.waitForTimeout(400);
				await ctx.h.paste('notes.md');
				await ctx.page.waitForTimeout(500);
				await ctx.h.press('Enter', '\u21b5');
				const tab = ctx.page.getByRole('tab', { name: /notes\.md/ });
				await tab.waitFor({ timeout: 10000 });
				await ctx.page.waitForTimeout(450);
				await ctx.look(tab);
				await ctx.hold();
				return 'the notes.md tab opened';
			},
		},
		{
			id: 'click', async run(ctx) {
				const item = ctx.page.getByRole('treeitem', { name: /README\.md/ });
				await ctx.h.hover(item, { ms: 320 });
				await ctx.at(ctx.cue('readme'));
				await ctx.h.click();
				const tab = ctx.page.getByRole('tab', { name: /README\.md/ });
				await tab.waitFor({ timeout: 10000 });
				await ctx.page.waitForTimeout(450);
				await ctx.look(tab);
				await ctx.hold();
				return 'the README.md tab opened';
			},
		},
	],
};
