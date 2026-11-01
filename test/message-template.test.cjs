const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCaption } = require('../dist/publishing/caption');
const { DEFAULT_MESSAGE_TEMPLATE, parseMessageTemplate } = require('../dist/publishing/message-template');
const job = { attemptId: '11111111-1111-4111-8111-111111111111', connectionId: 'connection', offerId: 'offer', groupId: 'test@g.us', title: 'Fone Bluetooth', description: 'Som para o seu dia', currentPrice: '50.00', originalPrice: '100.00', currency: 'BRL', couponCode: 'PROMO', affiliateUrl: 'https://meli.la/meu-link', sourceUrl: 'https://www.mercadolivre.com.br/p/MLB12345678', imageUrl: 'https://image.invalid' };
test('default format preserves product, prices, discount, coupon, affiliate link and invitation', () => {
 const text = buildCaption(job);
 assert.ok(text.startsWith('*Fone Bluetooth*'));
 for (const part of ['De: ~', '💵 Por:', '50% de desconto', 'Cupom: PROMO', 'https://meli.la/meu-link', 'Convide seus amigos']) assert.ok(text.includes(part), part);
 assert.equal(text.includes('Som para o seu dia'), false);
});
test('offer-specific phrase overrides the default without changing another offer', () => {
 const template = { ...DEFAULT_MESSAGE_TEMPLATE, showHeadline: true, headline: 'Chamada da conta' };
 assert.ok(buildCaption({ ...job, messageTemplate: template, messageHeadline: 'Só para quem ama música!' }).startsWith('*Só para quem ama música!*'));
 assert.ok(buildCaption({ ...job, messageTemplate: template }).startsWith('*Chamada da conta*'));
 assert.ok(buildCaption({ ...job, messageHeadline: 'Minha frase' }).startsWith('*Minha frase*'));
});
test('unchecked fields and absent coupons never appear in the message', () => {
 const text = buildCaption({ ...job, messageTemplate: { ...DEFAULT_MESSAGE_TEMPLATE, showCurrentPrice: false, showOriginalPrice: false, showDiscount: false, showCoupon: false, showFooter: false, showDescription: true } });
 assert.equal(text.includes('Por:'), false); assert.equal(text.includes('De:'), false); assert.equal(text.includes('desconto'), false); assert.equal(text.includes('Cupom'), false); assert.equal(text.includes('Convide'), false); assert.ok(text.includes(job.description));
 assert.equal(buildCaption({ ...job, couponCode: null }).includes('Cupom'), false);
});
test('invalid settings, empty text-only messages and excessive captions are rejected', () => {
 assert.throws(() => parseMessageTemplate({ ...DEFAULT_MESSAGE_TEMPLATE, showImage: 'false' }));
 const empty = { ...DEFAULT_MESSAGE_TEMPLATE };
 for (const key of Object.keys(empty)) if (key.startsWith('show')) empty[key] = false;
 assert.throws(() => buildCaption({ ...job, messageTemplate: empty }), /vazia/);
 assert.throws(() => buildCaption({ ...job, affiliateUrl: 'https://meli.la/' + 'a'.repeat(1100) }), /1000/);
});
test('disabling image sends text without downloading a photo or generating a link preview', async () => {
 require('../dist/publishing/image-download').downloadImage = async () => { throw Error('must not download'); };
 const { PublicationWorker } = require('../dist/publishing/publication-worker'); let sent, receipt;
 const api = { claimPublication: async () => ({ ...job, messageTemplate: { ...DEFAULT_MESSAGE_TEMPLATE, showImage: false } }), completePublication: async value => { receipt = value; } };
 const sessions = { readyConnectionIds: () => ['connection'], getReadyClient: () => ({ sendMessage: async (_group, body, options) => { sent = { body, options }; return { id: { _serialized: 'message' } }; } }) };
 const store = { list: async () => [], save: async () => {}, remove: async () => {} };
 await new PublicationWorker(api, sessions, store, true).poll();
 assert.equal(typeof sent.body, 'string'); assert.ok(sent.body.includes('*Fone Bluetooth*')); assert.equal(sent.options.caption, undefined); assert.equal(sent.options.linkPreview, false); assert.equal(receipt.outcome, 'SUCCESS');
});
