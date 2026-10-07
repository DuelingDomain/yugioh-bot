"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { safeReturnPath } from "@/lib/auth-return";

/**
 * Someone with an active session who opens /sign-in or /sign-up goes straight to their return path, so they
 * never reach Clerk's "session exists" error. Only the session found when Clerk first loads counts: a person
 * who signs in on this page keeps the success card and its own redirect. Returns true once the redirect started.
 */
export function useRedirectIfSignedIn(returnTo: string): boolean {
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const decided = useRef(false);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (!isLoaded || decided.current) return;
    decided.current = true;
    if (!isSignedIn) return;
    setRedirecting(true);
    router.replace(safeReturnPath(returnTo));
  }, [isLoaded, isSignedIn, returnTo, router]);

  return redirecting;
}
