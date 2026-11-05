import type Database from "better-sqlite3";

/** Additive migration. Send reservations and inbox suppression tombstones are permanent. */
export function migrateReleases(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      create table if not exists releases (
        id text primary key not null, version text not null unique, title text not null,
        major integer not null check(major in (0,1)), highlights_json text not null, sections_json text not null,
        published_at integer, auto_email integer not null default 0 check(auto_email in (0,1)),
        created_at integer not null, updated_at integer not null
      );
      create index if not exists releases_published_idx on releases(published_at desc);
      create table if not exists release_seen (
        user_id integer primary key references users(id) on delete cascade,
        release_id text not null references releases(id), updated_at integer not null
      );
      create table if not exists release_email_previews (
        token_hash text primary key not null, release_id text not null references releases(id),
        owner_user_id integer references users(id) on delete cascade, release_hash text not null,
        audience_hash text not null, counts_json text not null, payload_encrypted text not null,
        expires_at integer not null, created_at integer not null
      );
      create index if not exists release_email_previews_expiry_idx on release_email_previews(expires_at);
      create table if not exists release_email_sends (
        id text primary key not null, release_id text not null unique references releases(id),
        owner_user_id integer references users(id) on delete set null, confirmed_at integer not null,
        release_json text not null, template_version text not null, audience_hash text,
        counts_json text, status text not null check(status in ('preparing','queued','sending','done','needs_review')),
        available_at integer not null, attempts integer not null default 0,
        lease_token text, lease_expires_at integer, last_error text
      );
      create table if not exists release_email_deliveries (
        id integer primary key autoincrement, send_id text not null references release_email_sends(id),
        recipient_key text not null, payload_encrypted text, idempotency_key text not null unique,
        status text not null default 'pending' check(status in ('pending','processing','retry','accepted','delivered','failed','suppressed','needs_review')),
        provider_id text, first_attempt_at integer, accepted_at integer, delivered_at integer,
        attempts integer not null default 0, available_at integer not null,
        lease_token text, lease_expires_at integer, last_error text,
        unique(send_id,recipient_key)
      );
      create index if not exists release_email_deliveries_due_idx on release_email_deliveries(status,available_at,id);
      create unique index if not exists release_email_deliveries_provider_idx on release_email_deliveries(provider_id) where provider_id is not null;
      create table if not exists email_consents (
        recipient_key text primary key not null, scope text not null check(scope='alpha-news'),
        provenance text not null, text_version text not null, consented_at integer not null
      );
      create table if not exists email_unsubscribes (
        recipient_key text primary key not null, reason text not null, suppressed_at integer not null
      );
      create table if not exists email_unsubscribe_tokens (
        token_hash text primary key not null, recipient_key text not null
      );
      create index if not exists email_unsubscribe_tokens_recipient_idx on email_unsubscribe_tokens(recipient_key);
      create table if not exists email_budget (
        id integer primary key check(id=1), next_attempt_at integer not null,
        day_started_at integer not null, attempts integer not null
      );
      create table if not exists email_webhook_receipts (
        event_id text primary key not null, received_at integer not null
      );
    `);
    const sections = [
      { kind: "new", items: [
        'Synergy search groups. Search results now come in two groups: “Archetype cards” (cards of the archetype you searched) and “Works with” (cards from other archetypes that fit it).',
        "FAQ page. Answers to the questions players ask most, in one place.",
        "Large trailer window. The trailer now opens in a large window, so you can see the field clearly.",
      ] },
      { kind: "improvements", items: [
        "Better Suggest picks. The Suggest tab in the deck builder now gives cards that fit your deck better.",
        "Challenge button removed. To start a duel with a friend, use Create game and send the invite.",
      ] },
      { kind: "cards", items: ["Weekly card data update. New cards and script fixes from this week are in the engine."] },
      { kind: "fixes", items: ["Banished cards. A banished card that returns to the field now comes back correctly."] },
      { kind: "howto", items: [
        'Synergy search: Open a deck in Decks. Type an archetype name in search. Look at “Archetype cards” first, then “Works with”.',
        "Start a game with a friend: Go to Duels and select Create game. Choose the format and send the invite link.",
      ] },
    ];
    const highlights = [
      'Synergy search sorts results into “Archetype cards” and “Works with”.',
      "The Suggest tab gives better picks.", "New FAQ page and a large trailer window.",
      "Start a game with a friend using Create game and send the invite.", "Banished cards return correctly.",
    ];
    const at = Date.parse("2026-11-04T00:00:00.000Z");
    db.prepare(`insert into releases(id,version,title,major,highlights_json,sections_json,published_at,created_at,updated_at)
      values('release-0.2.2','0.2.2','Dueling Domain v0.2.2',0,?,?,?,?,?) on conflict(version) do nothing`)
      .run(JSON.stringify(highlights), JSON.stringify(sections), at, at, at);
  }).immediate();
}
