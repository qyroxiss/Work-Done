import type { Request, Response } from 'express';
import * as employees from '../services/employees.service.js';
import * as groups from '../services/productGroups.service.js';
import * as products from '../services/products.service.js';
import { idParam } from '../validators/common.js';
import {
  employeeBody,
  masterListQuery,
  productBody,
  productGroupBody,
  productListQuery,
} from '../validators/master.validators.js';

// ----- Employees -----
export async function listEmployees(req: Request, res: Response) {
  res.json(await employees.listEmployees(masterListQuery.parse(req.query)));
}
export async function getEmployee(req: Request, res: Response) {
  res.json(await employees.getEmployee(idParam.parse(req.params).id));
}
export async function createEmployee(req: Request, res: Response) {
  res.status(201).json(await employees.createEmployee(employeeBody.parse(req.body)));
}
export async function updateEmployee(req: Request, res: Response) {
  res.json(await employees.updateEmployee(idParam.parse(req.params).id, employeeBody.parse(req.body)));
}

// ----- Product groups -----
export async function listProductGroups(req: Request, res: Response) {
  res.json(await groups.listProductGroups(masterListQuery.parse(req.query)));
}
export async function getProductGroup(req: Request, res: Response) {
  res.json(await groups.getProductGroup(idParam.parse(req.params).id));
}
export async function createProductGroup(req: Request, res: Response) {
  res.status(201).json(await groups.createProductGroup(productGroupBody.parse(req.body)));
}
export async function updateProductGroup(req: Request, res: Response) {
  res.json(await groups.updateProductGroup(idParam.parse(req.params).id, productGroupBody.parse(req.body)));
}

// ----- Products -----
export async function listProducts(req: Request, res: Response) {
  res.json(await products.listProducts(productListQuery.parse(req.query)));
}
export async function getProduct(req: Request, res: Response) {
  res.json(await products.getProduct(idParam.parse(req.params).id));
}
export async function createProduct(req: Request, res: Response) {
  res.status(201).json(await products.createProduct(productBody.parse(req.body)));
}
export async function updateProduct(req: Request, res: Response) {
  res.json(await products.updateProduct(idParam.parse(req.params).id, productBody.parse(req.body)));
}
