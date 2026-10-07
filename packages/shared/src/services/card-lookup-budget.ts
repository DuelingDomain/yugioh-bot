/** One user request may issue at most this many remote card searches, including artwork enrichment. */
export const CARD_LOOKUP_LIMIT = 50;

export interface CardLookupBudget {
  remaining: number;
  lookupLimited: boolean;
}

export const createCardLookupBudget = (): CardLookupBudget => ({ remaining: CARD_LOOKUP_LIMIT, lookupLimited: false });

export function takeCardLookup(budget: CardLookupBudget): boolean {
  if (budget.remaining <= 0) {
    budget.lookupLimited = true;
    return false;
  }
  budget.remaining -= 1;
  return true;
}
