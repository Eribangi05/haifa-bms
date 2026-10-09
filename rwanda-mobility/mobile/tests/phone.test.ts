import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRIES } from '../src/lib/countries.ts';
import { byIso, flag, normalizeAny, prettyPhone, searchCountries, splitE164, toE164 } from '../src/lib/phone.ts';

test('the country list is comprehensive, with unique ISO codes and names in three languages', () => {
  assert.ok(COUNTRIES.length >= 230); assert.equal(new Set(COUNTRIES.map((c) => c.iso)).size, COUNTRIES.length);
  assert.ok(COUNTRIES.every((c) => c.en && c.fr && c.rw && /^\d{1,4}$/.test(c.dial)), 'every country has names and a calling code');
  assert.equal(byIso('RW').dial, '250'); assert.equal(byIso('UG').dial, '256'); assert.equal(byIso('US').dial, '1'); assert.equal(byIso('CD').fr, 'Congo-Kinshasa');
});
test('numbers typed under a country become E.164; Rwanda is strict, others are plausibility-checked', () => {
  const rw = byIso('RW'), ug = byIso('UG'), fr = byIso('FR');
  assert.equal(toE164(rw, '078 812 3456'), '+250788123456'); assert.equal(toE164(rw, '788123456'), '+250788123456'); assert.equal(toE164(rw, '2507881234'), null); assert.equal(toE164(rw, '0712345678'), null, '071 is not a Rwandan mobile prefix');
  assert.equal(toE164(ug, '0772 123 456'), '+256772123456'); assert.equal(toE164(fr, '06 12 34 56 78'), '+33612345678'); assert.equal(toE164(fr, '123'), null);
  assert.equal(toE164(fr, '33 6 12 34 56 78'), '+33612345678', 'country code typed again');
});
test('stored numbers are matched back to their country, and any way of writing a number is accepted', () => {
  assert.equal(splitE164('+250788123456')!.country.iso, 'RW'); assert.equal(splitE164('+14155550123')!.country.iso, 'US'); assert.equal(splitE164('+442071234567')!.country.iso, 'GB'); assert.equal(splitE164('+243812345678')!.country.iso, 'CD');
  assert.equal(normalizeAny('0788123456'), '+250788123456'); assert.equal(normalizeAny('+256 772 123 456'), '+256772123456'); assert.equal(normalizeAny('0033612345678'), '+33612345678'); assert.equal(normalizeAny('12345'), null);
  assert.equal(prettyPhone('+250788123456'), '+250 788 123 456'); assert.equal(flag('RW'), '🇷🇼');
});
test('country search works in every language, by code, and lists popular countries first', () => {
  assert.equal(searchCountries('', 'en')[0].iso, 'RW'); assert.equal(searchCountries('uganda', 'rw')[0].iso, 'UG'); assert.equal(searchCountries('allemagne', 'fr')[0].iso, 'DE'); assert.equal(searchCountries('+254', 'en')[0].iso, 'KE');
  assert.equal(searchCountries('ubudage', 'rw')[0].iso, 'DE'); assert.equal(searchCountries('zzzzzz', 'en').length, 0); assert.equal(searchCountries('cote', 'fr')[0].iso, 'CI');
});
