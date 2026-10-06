/** The npm 1v1 core predates triggering Link/Scale queries in the current script bundle. */
export function legacyNormalScript(name: string, content: string | null): string | null {
  if (name !== "chain.lua" || content == null) return content;
  // Keep direct getters and supported properties intact. Only the generic effect
  // registration snapshot must omit properties that this core cannot return.
  const start = "local function get_all_triggering_properties(ch)\n\tlocal t={}\n\tfor _,prop in ipairs(CARD_PROPERTIES) do";
  if (!content.includes(start)) throw new Error("Unsupported legacy chain.lua snapshot layout");
  return content.replace(start, `local function get_all_triggering_properties(ch)
\tlocal t={}
\tlocal supported={}
\tfor _,prop in ipairs(CARD_PROPERTIES) do
\t\tif prop~="Scale" and prop~="Link" then table.insert(supported,prop) end
\tend
\tfor _,prop in ipairs(supported) do`);
}
