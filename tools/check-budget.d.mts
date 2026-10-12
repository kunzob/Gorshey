export interface BudgetEntry {
  name: string;
  bytes: number;
}
export interface BudgetResult {
  entries: BudgetEntry[];
  total: number;
  limit: number;
  ok: boolean;
}
export const BUDGET_BYTES: number;
export const ARTWORK_RESERVE_BYTES: number;
export function measurePageLoad(dir: string): BudgetResult;
