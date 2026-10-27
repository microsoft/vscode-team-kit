// Copyright (c) Microsoft Corporation. Licensed under the MIT license.

let events = [];
let generation = 0;

self.onmessage = ({ data }) => {
	generation++;
	if (data.type === 'index') {
		events = data.events;
	} else if (data.type === 'find') {
		void find(data.query, data.id, generation);
	}
};

async function find(query, id, current) {
	const needle = query.toLocaleLowerCase();
	const matches = [];
	let deadline = performance.now() + 8;
	for (const event of events) {
		const readableMatches = [];
		const sections = [...event.sections.map(section => section.content), JSON.stringify(event.rawRecords, null, 2)];
		for (const [section, content] of sections.entries()) {
			if (section === event.sections.length && readableMatches.length) {
				break;
			}
			const haystack = content.toLocaleLowerCase();
			let offset = 0;
			let occurrence = 0;
			while (needle && (offset = haystack.indexOf(needle, offset)) !== -1) {
				readableMatches.push({ id: event.id, section, occurrence: occurrence++ });
				offset += needle.length;
				if (performance.now() >= deadline) {
					await new Promise(resolve => setTimeout(resolve, 0));
					if (current !== generation) {
						return;
					}
					deadline = performance.now() + 8;
				}
			}
			if (performance.now() >= deadline) {
				await new Promise(resolve => setTimeout(resolve, 0));
				if (current !== generation) {
					return;
				}
				deadline = performance.now() + 8;
			}
		}
		for (const match of readableMatches) {
			matches.push(match);
		}
	}
	if (current === generation) {
		self.postMessage({ id, query, matches });
	}
}
