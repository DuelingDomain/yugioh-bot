import { fireEvent, screen } from "@testing-library/react";

/** Opens a themed select by its label and clicks the option with this value. */
export function chooseThemed(label: string, value: string): void {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  const option = screen.getByRole("listbox", { name: label }).querySelector(`[role="option"][data-value="${value}"]`);
  if (!option) throw new Error(`No option ${value} in ${label}`);
  fireEvent.click(option);
}
