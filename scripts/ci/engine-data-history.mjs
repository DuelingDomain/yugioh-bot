/** Project report metadata into bounded, inert history data. No candidate code is run. */
export const HISTORY_FILE = "packages/web/src/lib/card-data-history.json";

const count = (value) => {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid history count");
  return value;
};
const text = (value) => {
  if (typeof value !== "string" || !value.trim() || value.length > 500) throw new Error("Invalid history text");
  return value;
};

export function historyDetails(artifact) {
  const relevance = artifact.relevance;
  const changes = artifact.cardChanges;
  const available = changes?.comparisonAvailable === true;
  const groups = available ? changes.added : [];
  if (!Array.isArray(groups)) throw new Error("Invalid history card groups");
  const cards = groups.flatMap((group) => {
    const setName = text(group.name);
    const setCode = group.code == null ? null : text(group.code);
    if (!Array.isArray(group.cards)) throw new Error("Invalid history cards");
    return group.cards.map((card) => {
      if (!Number.isSafeInteger(card.code) || card.code <= 0 || card.code > 0xffffffff || typeof card.prerelease !== "boolean") {
        throw new Error("Invalid history card identity");
      }
      return { name: text(card.name), passcode: card.code, setName, setCode, prerelease: card.prerelease };
    });
  });
  if (cards.length > 20000 || new Set(cards.map(card => card.passcode)).size !== cards.length) throw new Error("Invalid history card list");
  const setCodes = [...new Set(cards.flatMap(card => card.setCode ? [card.setCode] : []))].sort();
  if (relevance?.changedScripts !== undefined && (!Array.isArray(relevance.changedScripts) || relevance.changedScripts.some(path => typeof path !== "string"))) {
    throw new Error("Invalid history script changes");
  }
  return {
    counts: {
      newCards: count(relevance?.newCards), changedCards: count(relevance?.changedCards), removedCards: count(relevance?.removedCards),
      changedScripts: relevance?.changedScripts?.length ?? null, newSetCodes: available ? setCodes.length : null,
    },
    setCodes, newCards: cards, cardListAvailable: available,
    note: "Card counts compare loaded database rows. The card list follows the report and excludes blocked pre-release cards and graduations. Set codes are known sets of listed new cards.",
  };
}

export function appendHistory(history, details, { date, label, url, repository }) {
  if (!Array.isArray(history)) throw new Error("Invalid card data history");
  const prefix = `https://github.com/${repository}/pull/`;
  const number = url.startsWith(prefix) ? Number(url.slice(prefix.length)) : NaN;
  if (!Number.isSafeInteger(number) || number <= 0 || url !== `${prefix}${number}`) throw new Error("Invalid history PR URL");
  const entry = { date, label, pullRequest: { number, url }, ...details };
  return [entry, ...history.filter(item => item.pullRequest.url !== url)].sort((a, b) => b.date.localeCompare(a.date));
}
