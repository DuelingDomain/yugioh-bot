import { expect, type Page } from "@playwright/test";

export type SelectOption = { value: string } | { label: string } | { index: number };

/**
 * Picks an option of a themed select (ThemedSelect / SheetSelect). Opens the list from its button, then clicks the option.
 * `name` is the visible label (or aria-label) of the select. For the hidden native select, use its `data-testid` with `selectOption`.
 */
export async function pickSelect(page: Page, name: string, option: SelectOption): Promise<void> {
  const trigger = page.getByRole("combobox", { name, exact: true });
  await trigger.click();
  const list = page.getByRole("listbox", { name, exact: true });
  await expect(list).toBeVisible();
  const choice = "value" in option ? list.locator(`[role="option"][data-value="${option.value}"]`)
    : "label" in option ? list.getByRole("option", { name: option.label, exact: true })
      : list.getByRole("option").nth(option.index);
  await choice.click();
  await expect(list).toBeHidden();
}
