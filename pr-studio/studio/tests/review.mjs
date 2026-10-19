// The scope of a review round: the first round and big changes are reviewed in full; otherwise what changed and its
// neighbours.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewScope } from '../cli/lib/review.mjs';

test('a review round looks again only at what changed and its neighbours, unless much changed', () => {
	const ids = ['title', 'look', 'how', 'risk', 'status'];
	const show = r => `${r.scope}: ${r.look.join(' ')}`;
	assert.deepEqual({
		first: show(reviewScope(ids, { first: true })),
		one: show(reviewScope(ids, { first: false, changed: ['risk'], retold: [] })),
		edge: show(reviewScope(ids, { first: false, changed: ['title'], retold: ['title'] })),
		retold: show(reviewScope(ids, { first: false, changed: ['look', 'risk'], retold: ['look', 'risk'] })),
		many: show(reviewScope(ids, { first: false, changed: ['title', 'look', 'how'], retold: [] })),
		motion: show(reviewScope(ids, { first: false, global: true })),
		none: show(reviewScope(ids, { first: false, changed: [], retold: [] })),
	}, {
		first: 'full: title look how risk status',
		one: 'incremental: how risk status',
		edge: 'incremental: title look',
		retold: 'full: title look how risk status',
		many: 'full: title look how risk status',
		motion: 'full: title look how risk status',
		none: 'incremental: ',
	});
});
