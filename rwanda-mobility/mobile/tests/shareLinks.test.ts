import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inviteText, mailUrl, smsUrl, telUrl, whatsappUrl } from '../src/lib/shareLinks.ts';

test('whatsapp link: with and without a number, text is encoded', () => {
  assert.equal(whatsappUrl('Hi & bye'), 'https://wa.me/?text=Hi%20%26%20bye');
  assert.equal(whatsappUrl('x', '+250 786 880 880'), 'https://wa.me/250786880880?text=x');
});
test('sms link differs between Android and iOS', () => {
  assert.equal(smsUrl('code ABC', false), 'sms:?body=code%20ABC');
  assert.equal(smsUrl('code ABC', true), 'sms:&body=code%20ABC');
  assert.equal(smsUrl('x', false, '+250 786 880 880'), 'sms:+250786880880?body=x');
});
test('tel and mail links', () => {
  assert.equal(telUrl('+250 786 880 880'), 'tel:+250786880880'); assert.equal(telUrl(), 'tel:');
  assert.equal(mailUrl('Join me', 'Use code A&B'), 'mailto:?subject=Join%20me&body=Use%20code%20A%26B');
});
test('invite text appends the link only when there is one', () => {
  assert.equal(inviteText('Hello', ''), 'Hello'); assert.equal(inviteText('Hello', null), 'Hello'); assert.equal(inviteText('Hello', 'https://x.rw'), 'Hello\nhttps://x.rw');
});
