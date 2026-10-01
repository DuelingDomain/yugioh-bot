import { useRouter } from "next/navigation";

/**
 * The app router, or null when none is mounted (components rendered alone in
 * tests). The hook order stays the same either way: `useRouter` reads its
 * context first and only then throws.
 */
export function useOptionalRouter(): ReturnType<typeof useRouter> | null {
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useRouter();
  } catch {
    return null;
  }
}
