import type { Request, Response } from 'express';
import * as reports from '../services/reports.service.js';
import {
  listFilterQuery,
  optionalRangeQuery,
  requiredRangeQuery,
} from '../validators/report.validators.js';

export async function workSummary(req: Request, res: Response) {
  res.json(await reports.workSummary(requiredRangeQuery.parse(req.query)));
}

export async function pendingWork(req: Request, res: Response) {
  res.json(await reports.pendingWork(listFilterQuery.parse(req.query)));
}

export async function overdueWork(req: Request, res: Response) {
  res.json(await reports.overdueWork(listFilterQuery.parse(req.query)));
}

export async function completedWork(req: Request, res: Response) {
  res.json(await reports.completedWork(requiredRangeQuery.parse(req.query)));
}

export async function employeeWork(req: Request, res: Response) {
  res.json(await reports.employeeWork(optionalRangeQuery.parse(req.query)));
}
