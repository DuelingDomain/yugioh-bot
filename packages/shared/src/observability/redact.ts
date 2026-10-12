export function redactText(text: string): string {
  return text
    .replace(/(\/(?:api\/)?(?:drafts|duels|tournaments|cubes|decks))\/(?!new(?:[/?\s]|$)|\[)[^/\[\]?\s"<>]+(?:\?[^\s"<>]*)?/g, "$1/[slug]")
    .replace(/\b(?:SELECT|(?:INSERT|REPLACE)\s+INTO|UPDATE|DELETE\s+FROM|(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX)|PRAGMA|WITH\s+(?:RECURSIVE\s+)?\w+\s+AS)\b[\s\S]*?(?=\n\s+at\s|$)/gi, "[redacted]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[redacted]")
    .replace(/\bBearer\s+[^\s,;]+/gi, "[redacted]")
    .replace(/\b(?:sk_|pk_)[\w-]+/g, "[redacted]")
    .replace(/\bsha256=[\da-f]+/gi, "[redacted]")
    .replace(/\b[\da-f]{32,}\b/gi, "[redacted]")
    .replace(/\b[\w-]{10,}\.[\w-]{10,}\.[\w-]+\b/g, "[redacted]")
    .replace(/https?:\/\/[^\s"<>]+/gi, "[redacted]")
    .replace(/\b(?:token|secret|password|signature)\s*[:=]\s*[^\s,;]+/gi, "[redacted]");
}

const credentialKey = /authorization|cookie|token|secret|password|signature|apikey/i;
const privateKey = /^(?:authorization|cookie|cookies|setcookie|body|requestbody|email|username|displayname|discord.*|playerid|guildid|sessionid|userid|cardname|cardnames|title|slug|note|freetext|token|secret|password|signature|url|httpurl|requestpath|querystring|vars|x.*signature|xapikey)$/i;
const urlKey = /^(?:(?:http(?:request|response)?|request|response)?(?:url|uri|target)(?:full|original|query|querystring|fragment)?|(?:http(?:request|response)?|url)?(?:query|querystring|fragment))$/i;

export function redactEvent<T>(event: T): T {
  const seen = new WeakSet<object>();
  function clean(value: unknown, key = "", depth = 0): unknown {
    if (typeof value === "string") {
      if (["event_id", "trace_id", "span_id", "parent_span_id", "debug_id", "release"].includes(key) && /^[\da-f-]{16,40}$/i.test(value)) return value;
      if (["filename", "abs_path", "code_file"].includes(key) && /^https?:\/\/[^/?#]+\/_next\/static\/[^?#]+\.js$/.test(value)) return value;
      return redactText(value);
    }
    if (!value || typeof value !== "object") return value;
    if (seen.has(value) || depth >= 20) return "[redacted]";
    seen.add(value);
    if (Array.isArray(value)) {
      const result = value.map(item => clean(item, "", depth + 1));
      seen.delete(value);
      return result;
    }
    const result: Record<string, unknown> = {};
    for (const [field, item] of Object.entries(value)) {
      if (key === "headers" && !["accept", "content-type", "content-length"].includes(field.toLowerCase())) continue;
      if (key === "dynamicSamplingContext" && field === "public_key" && typeof item === "string" && /^[\da-f]{32}$/i.test(item)) {
        result[field] = item;
      } else if (field === "sdkProcessingMetadata" && depth === 0) {
        // Keep captured scope references; sampling context is copied into envelope headers.
        const metadata = item as Record<string, unknown> | null;
        const context = metadata?.dynamicSamplingContext;
        if (context && typeof context === "object") {
          const fields = Object.entries(context).filter(([name]) => !/transaction|url|uri|target|query|fragment|path|route|href/i.test(name));
          result[field] = { ...metadata, dynamicSamplingContext: clean(Object.fromEntries(fields), "dynamicSamplingContext", depth + 1) };
        } else result[field] = item;
      } else if (field === "user") {
        const id = (item as { id?: unknown } | null)?.id;
        if (typeof id === "string" && /^\d+$/.test(id)) result.user = { id };
      } else if (!(key === "request" && field === "data") && !privateKey.test(field.replace(/[-_.]/g, "")) && !credentialKey.test(field.replace(/[-_.]/g, "")) && !urlKey.test(field.replace(/[-_.]/g, ""))) result[field] = clean(item, field, depth + 1);
    }
    seen.delete(value);
    return result;
  }
  return clean(event) as T;
}
