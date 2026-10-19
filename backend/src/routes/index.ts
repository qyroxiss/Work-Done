import express, { Router } from 'express';
import { z } from 'zod';
import * as chat from '../controllers/chat.controller.js';
import * as masters from '../controllers/masters.controller.js';
import * as notifications from '../controllers/notifications.controller.js';
import * as recurring from '../controllers/recurring.controller.js';
import * as reports from '../controllers/reports.controller.js';
import * as users from '../controllers/users.controller.js';
import * as work from '../controllers/workItems.controller.js';
import { authenticate, currentUser, requireRole } from '../middleware/auth.js';
import { logSecurityEvent } from '../services/audit.service.js';
import { getClient, updateClient } from '../services/clients.service.js';
import { companyNameRule } from '../validators/common.js';

/**
 * Protected API routes. Every route requires a valid session; role checks are
 * enforced here on the server, independent of what the UI shows.
 */
export const apiRoutes = Router();
apiRoutes.use(authenticate);

const adminOnly = requireRole('Admin');
const managers = requireRole('Admin', 'Manager');

// Dashboard (scoped per user inside the service)
apiRoutes.get('/dashboard', work.dashboard);

// Employees: contact details are visible to managers; only admins change them
apiRoutes.get('/employees', managers, masters.listEmployees);
apiRoutes.get('/employees/:id', managers, masters.getEmployee);
apiRoutes.post('/employees', adminOnly, masters.createEmployee);
apiRoutes.put('/employees/:id', adminOnly, masters.updateEmployee);

// Product groups & products: readable by everyone (used in filters), editable by admins
apiRoutes.get('/product-groups', masters.listProductGroups);
apiRoutes.get('/product-groups/:id', masters.getProductGroup);
apiRoutes.post('/product-groups', adminOnly, masters.createProductGroup);
apiRoutes.put('/product-groups/:id', adminOnly, masters.updateProductGroup);

apiRoutes.get('/products', masters.listProducts);
apiRoutes.get('/products/:id', masters.getProduct);
apiRoutes.post('/products', adminOnly, masters.createProduct);
apiRoutes.put('/products/:id', adminOnly, masters.updateProduct);

// Work items: employees are limited to their assigned work inside the service
apiRoutes.get('/work-items', work.list);
apiRoutes.post('/work-items', managers, work.create);
apiRoutes.get('/work-items/:id', work.get);
apiRoutes.put('/work-items/:id', managers, work.update);
apiRoutes.post('/work-items/:id/assignments', managers, work.setAssignments);
apiRoutes.patch('/work-items/:id/status', work.changeStatus);
apiRoutes.post('/work-items/:id/notes', work.addNote);
apiRoutes.get('/work-items/:id/mentionable', work.mentionable);

// Files on work items (access checked inside the service, like the work item itself)
const workUpload = express.raw({ type: 'application/octet-stream', limit: '20mb' });
apiRoutes.post('/work-items/:id/attachments', workUpload, work.upload);
apiRoutes.get('/work-attachments/:id', work.download);
apiRoutes.delete('/work-attachments/:id', work.removeAttachment);

// Repeating work templates
apiRoutes.get('/recurring-work', managers, recurring.list);
apiRoutes.get('/recurring-work/:id', managers, recurring.get);
apiRoutes.post('/recurring-work', managers, recurring.create);
apiRoutes.put('/recurring-work/:id', managers, recurring.update);

// Notifications of the signed-in user
apiRoutes.get('/notifications', notifications.list);
apiRoutes.get('/notifications/unread', notifications.unread);
apiRoutes.post('/notifications/read', notifications.read);

// Reports
apiRoutes.get('/reports/work-summary', managers, reports.workSummary);
apiRoutes.get('/reports/pending-work', managers, reports.pendingWork);
apiRoutes.get('/reports/overdue-work', managers, reports.overdueWork);
apiRoutes.get('/reports/completed-work', managers, reports.completedWork);
apiRoutes.get('/reports/employee-work', managers, reports.employeeWork);

// Company of the signed-in user (its Client ID is fixed; only the display name can be changed)
apiRoutes.get('/settings/company', async (req, res) => {
  const client = await getClient(currentUser(req).clientId);
  res.json({ companyName: client.companyName, clientId: client.clientId });
});
apiRoutes.put('/settings/company', adminOnly, async (req, res) => {
  const { companyName } = z.object({ companyName: companyNameRule }).parse(req.body);
  const user = currentUser(req);
  const saved = await updateClient(user.clientId, { companyName });
  await logSecurityEvent('SETTINGS_UPDATED', {
    userId: user.userId,
    username: user.username,
    ip: req.ip,
    details: `Company name changed to "${companyName}"`,
  });
  res.json({ companyName: saved.companyName, clientId: saved.clientId });
});

// Chat between users of the same company (access checked inside the service)
const chatUpload = express.raw({ type: 'application/octet-stream', limit: '10mb' });
apiRoutes.get('/chat/users', chat.users);
apiRoutes.get('/chat/conversations', chat.conversations);
apiRoutes.get('/chat/conversations/:id', chat.conversation);
apiRoutes.post('/chat/direct', chat.openDirect);
apiRoutes.post('/chat/groups', chat.createGroup);
apiRoutes.patch('/chat/groups/:id', chat.renameGroup);
apiRoutes.get('/chat/conversations/:id/members', chat.members);
apiRoutes.post('/chat/groups/:id/members', chat.addMembers);
apiRoutes.delete('/chat/groups/:id/members/:userId', chat.removeMember);
apiRoutes.get('/chat/conversations/:id/messages', chat.messages);
apiRoutes.post('/chat/conversations/:id/messages', chat.send);
apiRoutes.post('/chat/conversations/:id/attachments', chatUpload, chat.upload);
apiRoutes.patch('/chat/messages/:id', chat.edit);
apiRoutes.delete('/chat/messages/:id', chat.remove);
apiRoutes.get('/chat/attachments/:id', chat.download);
apiRoutes.post('/chat/conversations/:id/read', chat.read);
apiRoutes.get('/chat/unread', chat.unread);
apiRoutes.get('/chat/search', chat.search);
apiRoutes.get('/chat/events', chat.events);

// User accounts
apiRoutes.get('/users', adminOnly, users.listUsers);
apiRoutes.get('/users/:id', adminOnly, users.getUser);
apiRoutes.post('/users', adminOnly, users.createUser);
apiRoutes.put('/users/:id', adminOnly, users.updateUser);
apiRoutes.post('/users/:id/reset-password', adminOnly, users.resetPassword);
