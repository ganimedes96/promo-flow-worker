const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readdir, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { GroupActivityTracker, activityFromNotification } = require('../dist/whatsapp/group-activity');
const notification = () => ({ id: { _serialized: 'private-event-id' }, chatId: '123@g.us', recipientIds: ['private-member', 'private-member', 'other-private-member'], timestamp: Math.floor(Date.now()/1000) });
test('membership data contains only counts and a stable opaque event ID', () => {
 const event = activityFromNotification('JOIN', notification());
 assert.equal(event.count, 2);
 assert.match(event.eventId, /^[a-f0-9]{64}$/);
 assert.equal(event.eventId, activityFromNotification('JOIN', notification()).eventId);
 assert.ok(!JSON.stringify(event).includes('private'));
 assert.equal(activityFromNotification('JOIN', { ...notification(), recipientIds: [] }), null);
});
test('journal survives failure and restart, separates accounts and removes acknowledged events', async () => {
 const directory = await mkdtemp(join(tmpdir(), 'group-activity-'));
 try {
  const tracker = new GroupActivityTracker({ recordGroupActivity: async () => { throw new Error('offline'); } }, directory);
  tracker.receive('11111111-1111-4111-8111-111111111111', '5511999999999', 'JOIN', notification());
  tracker.receive('22222222-2222-4222-8222-222222222222', '5511888888888', 'JOIN', notification());
  await tracker.stop();
  assert.equal((await readdir(directory)).length, 2);
  const serialized = await readFile(join(directory, (await readdir(directory))[0]), 'utf8');
  assert.ok(!serialized.includes('private'));
  await tracker.poll();
  assert.equal((await readdir(directory)).length, 2);
  const received = [];
  const restarted = new GroupActivityTracker({ recordGroupActivity: async (id, body) => { received.push(id); return { accepted: body.events.map(event => event.eventId) }; } }, directory);
  await restarted.poll();
  assert.equal(new Set(received).size, 2);
  assert.equal((await readdir(directory)).length, 0);
 } finally { await rm(directory, { recursive: true, force: true }); }
});
