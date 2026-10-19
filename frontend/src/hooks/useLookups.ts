import { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Employee, Paged, Product, ProductGroup } from '../types';

interface Lookups {
  employees: Employee[];
  groups: ProductGroup[];
  products: Product[];
  loading: boolean;
}

/**
 * Loads master lists for dropdowns. Employees are only requested for managers
 * (the API does not expose employee contact details to employees).
 */
export function useLookups({ employees = false, includeInactive = false } = {}): Lookups {
  const [state, setState] = useState<Lookups>({ employees: [], groups: [], products: [], loading: true });

  useEffect(() => {
    let cancelled = false;
    const active = includeInactive ? '' : '&isActive=true';
    Promise.all([
      employees ? api.get<Paged<Employee>>(`/employees?pageSize=500${active}`) : Promise.resolve(null),
      api.get<Paged<ProductGroup>>(`/product-groups?pageSize=500${active}`),
      api.get<Paged<Product>>(`/products?pageSize=500${active}`),
    ])
      .then(([e, g, p]) => {
        if (!cancelled) {
          setState({ employees: e?.items ?? [], groups: g.items, products: p.items, loading: false });
        }
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [employees, includeInactive]);

  return state;
}
