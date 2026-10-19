import type { Role, WorkStatus } from '../types/domain.js';

/**
 * Work status rules (business decisions — adjust here if the office process differs):
 *
 *   Pending     -> In Progress, On Hold
 *   In Progress -> On Hold, Completed            (Completed = submitted for review)
 *   On Hold     -> In Progress
 *   Reopened    -> In Progress, On Hold
 *   Completed   -> Closed, Reopened              (Manager/Admin only: review outcome)
 *   Closed      -> Reopened                      (Manager/Admin only)
 *
 * Employees may change status only on work assigned to them.
 * Managers/Admins may perform every transition.
 */
interface Transition {
  to: WorkStatus;
  managerOnly?: boolean;
}

const TRANSITIONS: Record<WorkStatus, Transition[]> = {
  Pending: [{ to: 'In Progress' }, { to: 'On Hold' }],
  'In Progress': [{ to: 'On Hold' }, { to: 'Completed' }],
  'On Hold': [{ to: 'In Progress' }],
  Reopened: [{ to: 'In Progress' }, { to: 'On Hold' }],
  Completed: [
    { to: 'Closed', managerOnly: true },
    { to: 'Reopened', managerOnly: true },
  ],
  Closed: [{ to: 'Reopened', managerOnly: true }],
};

/** Moving to these statuses requires a note explaining why. */
export const NOTES_REQUIRED: readonly WorkStatus[] = ['On Hold', 'Reopened'];

export function isManager(role: Role): boolean {
  return role === 'Admin' || role === 'Manager';
}

export function allowedTransitions(from: WorkStatus, role: Role): WorkStatus[] {
  return TRANSITIONS[from]
    .filter((t) => !t.managerOnly || isManager(role))
    .map((t) => t.to);
}
