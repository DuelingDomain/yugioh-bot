import { sv } from "./sv-util";

/** One 1px line in `--rule-lo`. With `beam`, the line is `rgb(var(--beam) / .22)`. */
export function LightRule({ beam = false, className }: { beam?: boolean; className?: string }) {
  return <hr className={sv("sv-rule", className)} data-beam={beam ? "true" : undefined} />;
}
