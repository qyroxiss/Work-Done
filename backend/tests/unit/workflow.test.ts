import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WORK_STATUSES, type Role } from '../../src/types/domain.js';
import { allowedTransitions, isManager, NOTES_REQUIRED } from '../../src/services/workflow.js';

describe('work status rules', () => {
  it('lets employees start, pause and submit work', () => {
    assert.deepEqual(allowedTransitions('Pending', 'Employee'), ['In Progress', 'On Hold']);
    assert.deepEqual(allowedTransitions('In Progress', 'Employee'), ['On Hold', 'Completed']);
    assert.deepEqual(allowedTransitions('On Hold', 'Employee'), ['In Progress']);
    assert.deepEqual(allowedTransitions('Reopened', 'Employee'), ['In Progress', 'On Hold']);
  });

  it('keeps review decisions for managers', () => {
    assert.deepEqual(allowedTransitions('Completed', 'Employee'), []);
    assert.deepEqual(allowedTransitions('Closed', 'Employee'), []);
    for (const role of ['Admin', 'Manager'] as Role[]) {
      assert.deepEqual(allowedTransitions('Completed', role), ['Closed', 'Reopened']);
      assert.deepEqual(allowedTransitions('Closed', role), ['Reopened']);
    }
  });

  it('never allows a status to move to itself', () => {
    for (const status of WORK_STATUSES) {
      assert.ok(!allowedTransitions(status, 'Admin').includes(status), status);
    }
  });

  it('requires a note for On Hold and Reopened', () => {
    assert.deepEqual([...NOTES_REQUIRED], ['On Hold', 'Reopened']);
  });

  it('treats only Admin and Manager as managers', () => {
    assert.equal(isManager('Admin'), true);
    assert.equal(isManager('Manager'), true);
    assert.equal(isManager('Employee'), false);
  });
});
