export const ROLES = ['Admin', 'Manager', 'Employee'] as const;
export type Role = (typeof ROLES)[number];

export const WORK_STATUSES = [
  'Pending',
  'In Progress',
  'On Hold',
  'Completed',
  'Closed',
  'Reopened',
] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

/** Statuses that count as "open" work (not yet submitted or closed). */
export const OPEN_STATUSES: WorkStatus[] = ['Pending', 'In Progress', 'On Hold', 'Reopened'];

export const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface AuthUser {
  userId: number;
  username: string;
  role: Role;
  employeeId: number | null;
  employeeName: string | null;
  mustChangePassword: boolean;
  sessionId: number;
  /** Client company the user belongs to (selects the database) */
  clientId: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
