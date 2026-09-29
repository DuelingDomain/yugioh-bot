import { access, cp } from "node:fs/promises";

const webRoot = new URL("../", import.meta.url);
const standaloneRoot = new URL(".next/standalone/packages/web/", webRoot);

// Next traces server dependencies, but leaves browser assets outside standalone.
await access(new URL("server.js", standaloneRoot));
await cp(new URL(".next/static/", webRoot), new URL(".next/static/", standaloneRoot), {
  recursive: true,
});
await cp(new URL("public/", webRoot), new URL("public/", standaloneRoot), {
  recursive: true,
});
