/**
 * The Updates board and release email, as the web routes send them (see the shared contract in the work notes).
 * These are client-side shapes: the routes live in app/api/releases and app/api/admin/console/releases.
 */
export const SECTION_KINDS = ["new", "improvements", "cards", "fixes", "howto"] as const;
export type ReleaseSectionKind = (typeof SECTION_KINDS)[number];

export interface ReleaseSection {
  kind: ReleaseSectionKind;
  items: string[];
}

export interface Release {
  id: string;
  /** "0.2.2" */
  version: string;
  /** "Dueling Domain v0.2.2" */
  title: string;
  major: boolean;
  /** ISO time. */
  publishedAt: string;
  /** Up to 6 short lines for the card reveal and the compact panel. */
  highlights: string[];
  sections: ReleaseSection[];
}

export interface ReleasesResponse {
  releases: Release[];
  lastSeenVersion: string | null;
}

export type EmailState = "none" | "queued" | "sending" | "done" | "needs_review" | "not_configured";

export interface EmailSendState {
  state: EmailState;
  queued: number;
  sent: number;
  failed: number;
  total: number;
  /** When the owner confirmed the one send. */
  confirmedAt?: string;
}

export interface AdminRelease extends Omit<Release, "publishedAt"> {
  publishedAt?: string | null;
  status: "draft" | "published";
  email: EmailSendState;
}

export interface AdminReleasesResponse {
  releases: AdminRelease[];
  emailConfigured: boolean;
  missingConfig: string[];
}

/** What the editor sends for a draft. */
export interface ReleaseDraftInput {
  version: string;
  title: string;
  major: boolean;
  highlights: string[];
  sections: ReleaseSection[];
}

export interface EmailPreview {
  token: string;
  counts: {
    members: number;
    invited: number;
    waitlist: number;
    total: number;
    excluded: { reason: string; count: number }[];
  };
  /** ISO time. The token stops working after this. */
  expiresAt: string;
}
