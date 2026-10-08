"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";

const PRODUCTION_APP_ORIGIN = "https://app.duelingdomain.com";
const COOKIE_ATTRIBUTES = "Domain=duelingdomain.com; Path=/; Secure; SameSite=Lax";

/** Clear the routing hint before leaving the app, even if Clerk cannot report sign-out. */
export function clearMarketingSessionHint() {
  if (typeof window === "undefined" || window.location.origin !== PRODUCTION_APP_ORIGIN) return;
  document.cookie = `dd_signed_in=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}

/** An apex-visible routing hint; Clerk remains responsible for authentication. */
export function MarketingSessionHint() {
  const { isLoaded, isSignedIn } = useAuth();
  useEffect(() => {
    if (!isLoaded || typeof isSignedIn !== "boolean" || window.location.origin !== PRODUCTION_APP_ORIGIN) return;
    if (isSignedIn) {
      document.cookie = `dd_signed_in=1; ${COOKIE_ATTRIBUTES}; Max-Age=2592000`;
    } else {
      clearMarketingSessionHint();
    }
  }, [isLoaded, isSignedIn]);
  return null;
}
