/** Longest engine title the slim select bar shows as it is; longer ones get a short label. */
const BAR_TITLE_MAX = 26;

/**
 * Short label for the slim select bar. Engine hints are long ("Select the card(s) to use as Synchro
 * Material") and the bar is only as wide as the gap between the Extra Monster Zones. The full title stays
 * available as the bar's tooltip.
 */
export function barTitleLabel(title: string): string {
  const text = title.trim();
  if (text.length <= BAR_TITLE_MAX) return text;
  if (/material/i.test(text)) return "Select materials";
  if (/^select\s+(?:the\s+)?(?:\d+\s+(?:to\s+\d+\s+)?)?card\(s\)/i.test(text)) return "Select cards";
  return text;
}
