import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applicationSteps, driverKind, jobKind, jobTypes, splitByService } from '../src/lib/driverKind.ts';

test('driverKind: owner, Abasare, both, new', () => {
  assert.equal(driverKind({ vehicle: { plate: 'RAB123C' }, abasare: { status: 'none' } }), 'own');
  assert.equal(driverKind({ vehicle: null, abasare: { status: 'approved' } }), 'abasare');
  assert.equal(driverKind({ vehicle: null, abasare: { status: 'pending' } }), 'abasare');
  assert.equal(driverKind({ vehicle: { plate: 'x' }, abasare: { status: 'approved' } }), 'both');
  assert.equal(driverKind({ vehicle: null, abasare: { status: 'none' } }), 'new');
  assert.equal(driverKind(null), 'new'); assert.equal(driverKind({}), 'new');
});
test('jobTypes lists only approved paths', () => {
  assert.deepEqual(jobTypes({ ridePermitted: true, abasarePermitted: false }), ['ride']);
  assert.deepEqual(jobTypes({ ridePermitted: true, abasarePermitted: true }), ['ride', 'abasare']);
  assert.deepEqual(jobTypes({ ridePermitted: false, abasarePermitted: true }), ['abasare']);
  assert.deepEqual(jobTypes({ ridePermitted: false, abasarePermitted: false }), []);
});
const st = (o: Parameters<typeof applicationSteps>[0]) => applicationSteps(o).map((s) => s.state[0]).join('');   // d / c / t
test('applicationSteps follows the application', () => {
  assert.equal(st({ profileStatus: 'APPLICATION_STARTED', chosen: false, saved: false, docsOk: false }), 'ctttt');
  assert.equal(st({ profileStatus: 'APPLICATION_STARTED', chosen: true, saved: false, docsOk: false }), 'dcttt');
  assert.equal(st({ profileStatus: 'APPLICATION_STARTED', chosen: true, saved: true, docsOk: false }), 'ddctt');
  assert.equal(st({ profileStatus: 'APPLICATION_STARTED', chosen: true, saved: true, docsOk: true }), 'dddct');
  assert.equal(st({ profileStatus: 'UNDER_REVIEW', chosen: true, saved: true, docsOk: true }), 'dddct');
  assert.equal(st({ profileStatus: 'INFO_REQUIRED', chosen: true, saved: true, docsOk: true }), 'ddctt');
  assert.equal(st({ profileStatus: 'APPROVED', chosen: true, saved: true, docsOk: true }), 'ddddd');
});
test('splitByService separates ride and Abasare and ignores unfinished jobs', () => {
  const s = splitByService([
    { status: 'PAYMENT_COMPLETED', final_fare: 2000, estimated_driver_net: 1700 },
    { status: 'PAYMENT_COMPLETED', final_fare: 15000, estimated_driver_net: 12000, abasare: { mode: 'hourly' } },
    { status: 'COMPLETED', final_fare: 1000, estimated_driver_net: 900, service_id: 'abasare' },
    { status: 'CANCELLED_BY_DRIVER', final_fare: null }, { status: 'IN_PROGRESS', final_fare: 500 },
  ]);
  assert.deepEqual(s.ride, { trips: 1, fares: 2000, net: 1700 }); assert.deepEqual(s.abasare, { trips: 2, fares: 16000, net: 12900 });
  assert.equal(jobKind({ status: 'x', final_fare: 0, abasare: {} }), 'abasare'); assert.equal(jobKind({ status: 'x', final_fare: 0, service_id: 'abasare_hourly' }), 'abasare'); assert.equal(jobKind({ status: 'x', final_fare: 0, service_id: 'moto' }), 'ride');
});
