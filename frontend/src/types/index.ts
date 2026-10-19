export type Role = 'Admin' | 'Manager' | 'Employee';
export type WorkStatus = 'Pending' | 'In Progress' | 'On Hold' | 'Completed' | 'Closed' | 'Reopened';
export type Priority = 'Low' | 'Medium' | 'High' | 'Urgent';

export const WORK_STATUSES: WorkStatus[] = ['Pending', 'In Progress', 'On Hold', 'Completed', 'Closed', 'Reopened'];
export const OPEN_STATUSES: WorkStatus[] = ['Pending', 'In Progress', 'On Hold', 'Reopened'];
export const PRIORITIES: Priority[] = ['Low', 'Medium', 'High', 'Urgent'];
export const ROLES: Role[] = ['Admin', 'Manager', 'Employee'];

export interface AuthUser {
  userId: number;
  username: string;
  role: Role;
  employeeId: number | null;
  employeeName: string | null;
  mustChangePassword: boolean;
  clientId: string;
}

/** Client company of the signed-in user */
export interface Company {
  name: string;
  clientId: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Employee {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  department: string | null;
  phone: string | null;
  email: string | null;
  joiningDate: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductGroup {
  productGroupId: number;
  groupCode: string;
  groupName: string;
  description: string | null;
  isActive: boolean;
  productCount: number;
  createdAt: string;
}

export interface Product {
  productId: number;
  productCode: string;
  productName: string;
  productGroupId: number;
  groupName: string;
  groupCode: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface UserAccount {
  userId: number;
  clientId: string;
  username: string;
  role: Role;
  employeeId: number | null;
  employeeName: string | null;
  employeeCode: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Assignee {
  employeeId: number;
  employeeCode: string;
  employeeName: string;
  assignedAt?: string | null;
  assignedByName?: string | null;
}

export interface WorkListItem {
  workId: number;
  workNo: string;
  title: string;
  priority: Priority;
  status: WorkStatus;
  startDate: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  productId: number | null;
  productCode: string | null;
  productName: string | null;
  productGroupId: number | null;
  groupName: string | null;
  isOverdue: boolean;
  assignees: Assignee[];
}

export interface HistoryEntry {
  historyId: number;
  entryType: 'Created' | 'StatusChange' | 'Note' | 'Assignment' | 'Edit' | 'Attachment';
  oldStatus: WorkStatus | null;
  newStatus: WorkStatus;
  notes: string | null;
  changedAt: string;
  changedByName: string;
}

export interface WorkDetail extends WorkListItem {
  description: string | null;
  rowVersion: string;
  createdByUserId: number;
  createdByName: string;
  history: HistoryEntry[];
  allowedTransitions: WorkStatus[];
  notesRequiredFor: WorkStatus[];
  canEdit: boolean;
  canAssign: boolean;
  attachments: WorkAttachment[];
  canAttach: boolean;
  recurringId: number | null;
  recurringFrequency: Frequency | null;
}

export interface WorkAttachment {
  attachmentId: number;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: string;
  uploadedByName: string;
  canDelete: boolean;
}

export interface MentionableUser {
  userId: number;
  username: string;
  name: string;
  role: Role;
}

// ---------------------------------------------------------------- Repeating work
export type Frequency = 'Weekly' | 'Monthly' | 'Quarterly' | 'Yearly';
export const FREQUENCIES: Frequency[] = ['Weekly', 'Monthly', 'Quarterly', 'Yearly'];

export interface RecurringTemplate {
  recurringId: number;
  title: string;
  description: string | null;
  productGroupId: number | null;
  groupName: string | null;
  productId: number | null;
  productName: string | null;
  priority: Priority;
  frequency: Frequency;
  nextDueDate: string;
  nextCreateDate: string | null;
  leadDays: number;
  endDate: string | null;
  ended: boolean;
  isActive: boolean;
  createdCount: number;
  lastCreatedAt: string | null;
  createdByName: string;
  upcoming: string[];
  assignees: { employeeId: number; employeeName: string }[];
}

// ---------------------------------------------------------------- Notifications
export type NotificationKind = 'Assigned' | 'Status' | 'Note' | 'Mention' | 'Attachment' | 'DueToday' | 'Overdue' | 'Created';

export interface AppNotification {
  notificationId: number;
  kind: NotificationKind;
  workId: number | null;
  actorName: string | null;
  message: string;
  createdAt: string;
  readAt: string | null;
}

export interface ActivityEntry extends HistoryEntry {
  workId: number;
  workNo: string;
  title: string;
}

export interface DashboardData {
  statusCounts: Record<WorkStatus, number>;
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  unassigned: number;
  upcoming: WorkListItem[];
  recentActivity: ActivityEntry[];
}

// ---------------------------------------------------------------- Chat
export type ConversationKind = 'Company' | 'Direct' | 'Group';

export interface ChatAttachment {
  attachmentId: number;
  fileName: string;
  contentType: string;
  size: number;
}

export interface ChatMessage {
  messageId: number;
  conversationId: number;
  senderUserId: number;
  senderName: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  attachment: ChatAttachment | null;
}

export interface ChatConversation {
  conversationId: number;
  kind: ConversationKind;
  title: string;
  createdByUserId: number | null;
  memberCount: number;
  otherUserId: number | null;
  otherRole: Role | null;
  otherActive: boolean | null;
  unread: number;
  lastReadMessageId: number;
  lastMessage: { messageId: number; body: string; senderUserId: number; createdAt: string } | null;
}

export interface ChatUser {
  userId: number;
  name: string;
  username: string;
  role: Role;
}

export interface ChatMember {
  userId: number;
  name: string;
  role: Role;
  isActive: boolean;
  isCreator: boolean;
}

export interface ChatSearchResult {
  message: ChatMessage;
  kind: ConversationKind;
  conversationTitle: string;
}

/** Live event pushed by the server */
export type ChatEvent =
  | { type: 'message'; message: ChatMessage & { kind: ConversationKind } }
  | { type: 'message-updated'; message: ChatMessage }
  | { type: 'read'; conversationId: number; messageId: number }
  | { type: 'conversation'; conversationId: number }
  | { type: 'notification'; notification: AppNotification }
  | { type: 'notifications-read'; unread: number };
