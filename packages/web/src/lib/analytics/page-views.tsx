"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type { CaptureResult } from "posthog-js";

function pageRoute(pathname: string): string | null {
  if (["/access", "/dashboard", "/drafts", "/tournaments", "/tournaments/new", "/cubes"].includes(pathname)) return pathname;
  if (/^\/sign-up(?:\/.*)?$/.test(pathname)) return "/sign-up";
  if (/^\/draft\/[^/]+$/.test(pathname)) return "/draft/[slug]";
  if (/^\/duels\/(?!new$|dev-presets$)[^/]+$/.test(pathname)) return "/duels/[slug]";
  if (/^\/tournament\/[^/]+(?:\/standings)?$/.test(pathname)) return pathname.endsWith("/standings") ? "/tournament/[slug]/standings" : "/tournament/[slug]";
  if (/^\/cubes\/[^/]+$/.test(pathname)) return "/cubes/[id]";
  return null;
}

function pageViewOnly(event: CaptureResult): CaptureResult | null {
  const route = pageRoute(window.location.pathname);
  if (event.event !== "$pageview" || !route) return null;
  // Rebuild properties so SDK defaults cannot add titles, referrers or URL text.
  return {
    event: event.event,
    uuid: event.uuid,
    timestamp: event.timestamp,
    properties: {
      token: event.properties.token,
      distinct_id: event.properties.distinct_id,
      $cookieless_mode: event.properties.$cookieless_mode,
      $lib: event.properties.$lib,
      $lib_version: event.properties.$lib_version,
      $process_person_profile: false,
      $current_url: window.location.origin + route,
      $host: window.location.host,
      $pathname: route,
    },
  };
}

export function PageViews() {
  const pathname = usePathname();
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
    if (!key || !pathname || !pageRoute(pathname)) return;
    void import("posthog-js").then(({ default: posthog }) => {
      if (posthog.__loaded || !pageRoute(window.location.pathname)) return;
      posthog.init(key, {
        api_host: "/ingest",
        cookieless_mode: "always",
        capture_pageview: "history_change",
        autocapture: false,
        disable_session_recording: true,
        capture_pageleave: false,
        person_profiles: "never",
        advanced_disable_flags: true,
        disable_external_dependency_loading: true,
        save_referrer: false,
        save_campaign_params: false,
        before_send: pageViewOnly,
      });
    }).catch(() => {});
  }, [pathname]);
  return null;
}
