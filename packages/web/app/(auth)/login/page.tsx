import { redirect } from "next/navigation";
// Local bridge until Task 2's safeReturnPath is integrated.
function safePath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20\x7f]/.test(value)) return "/dashboard";
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || /[\\\x00-\x20\x7f]/.test(decoded)) return "/dashboard";
    const url = new URL(value, "https://local.invalid");
    return url.origin === "https://local.invalid" && !url.pathname.startsWith("//") ? url.pathname + url.search + url.hash : "/dashboard";
  } catch { return "/dashboard"; }
}
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string | string[] }> }) {
  const path = safePath((await searchParams).callbackUrl);
  redirect(`/sign-in?${new URLSearchParams({ redirect_url: path })}`);
}
