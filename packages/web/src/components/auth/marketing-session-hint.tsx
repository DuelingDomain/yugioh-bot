"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";

/** An apex-visible routing hint; Clerk remains responsible for authentication. */
export function MarketingSessionHint() {
  const { isLoaded, isSignedIn } = useAuth();
  useEffect(() => {
    if (!isLoaded || typeof isSignedIn !== "boolean" || window.location.origin !== "https://app.duelingdomain.com") return;
    document.cookie = `dd_signed_in=${isSignedIn ? "1" : ""}; Domain=duelingdomain.com; Path=/; Max-Age=${isSignedIn ? 2592000 : 0}; Secure; SameSite=Lax`;
  }, [isLoaded, isSignedIn]);
  return null;
}
