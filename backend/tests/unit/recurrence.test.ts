import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, anchorDayOf, createOn, dueOccurrences, fillTitle, nextOccurrence } from '../../src/services/recurrence.js';

describe('nextOccurrence', () => {
  it('adds a week for weekly work', () => {
    assert.equal(nextOccurrence('2026-12-28', 'Weekly', 28), '2027-01-04');
  });

  it('keeps the same day for monthly work', () => {
    assert.equal(nextOccurrence('2026-10-20', 'Monthly', 20), '2026-11-20');
    assert.equal(nextOccurrence('2026-12-20', 'Monthly', 20), '2027-01-20');
  });

  it('uses the last day of shorter months without drifting', () => {
    assert.equal(nextOccurrence('2027-01-31', 'Monthly', 31), '2027-02-28');
    assert.equal(nextOccurrence('2027-02-28', 'Monthly', 31), '2027-03-31');
    assert.equal(nextOccurrence('2028-01-31', 'Monthly', 31), '2028-02-29'); // leap year
  });

  it('handles quarterly and yearly work', () => {
    assert.equal(nextOccurrence('2026-07-31', 'Quarterly', 31), '2026-10-31');
    assert.equal(nextOccurrence('2026-11-30', 'Quarterly', 30), '2027-02-28');
    assert.equal(nextOccurrence('2028-02-29', 'Yearly', 29), '2029-02-28');
  });
});

describe('dueOccurrences', () => {
  it('creates nothing before the lead time starts', () => {
    const r = dueOccurrences('2026-10-20', 'Monthly', 20, 7, '2026-10-12', null);
    assert.deepEqual(r.due, []);
    assert.equal(r.nextDue, '2026-10-20');
  });

  it('creates the occurrence once the lead time starts', () => {
    const r = dueOccurrences('2026-10-20', 'Monthly', 20, 7, '2026-10-13', null);
    assert.deepEqual(r.due, ['2026-10-20']);
    assert.equal(r.nextDue, '2026-11-20');
  });

  it('catches up after downtime, capped', () => {
    const r = dueOccurrences('2026-01-05', 'Weekly', 5, 0, '2026-03-02', null, 5);
    assert.equal(r.due.length, 5);
    assert.equal(r.due[0], '2026-01-05');
    assert.equal(r.nextDue, '2026-02-09');
  });

  it('stops at the end date', () => {
    const r = dueOccurrences('2026-10-20', 'Monthly', 20, 60, '2026-12-31', '2026-11-30');
    assert.deepEqual(r.due, ['2026-10-20', '2026-11-20']);
  });
});

describe('helpers', () => {
  it('computes start dates and anchor days', () => {
    assert.equal(createOn('2026-03-01', 1), '2026-02-28');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(anchorDayOf('2026-10-31'), 31);
  });

  it('fills title placeholders', () => {
    assert.equal(fillTitle('GSTR-3B for {prevMonth}', '2026-10-20'), 'GSTR-3B for Sep 2026');
    assert.equal(fillTitle('GSTR-1 {prevMonth}', '2027-01-11'), 'GSTR-1 Dec 2026');
    assert.equal(fillTitle('Payroll {month} (due {date})', '2026-10-05'), 'Payroll Oct 2026 (due 5 Oct 2026)');
    assert.equal(fillTitle('No placeholders', '2026-10-05'), 'No placeholders');
  });
});
