import type Database from 'better-sqlite3';

/** Additive shared migration; consent is never inferred from alpha membership. */
export function migrateVisionFeedback(db: Database.Database) {
  db.exec(`
    create table if not exists vision_feedback_preferences (
      user_id integer primary key references users(id) on delete cascade,
      enabled integer not null default 0 check(enabled in (0,1)),
      asked_at integer not null,
      last_sample_at integer,
      window_at integer not null default 0,
      attempts integer not null default 0
    );
    create table if not exists vision_samples (
      id text primary key,
      user_id integer not null references users(id) on delete cascade,
      created_at integer not null,
      fingerprint text not null,
      crop_bytes integer not null check(crop_bytes between 1 and 32768),
      embedding_json text not null,
      top5_json text not null,
      chosen_card_id text not null,
      tier text not null check(tier in ('sure','not sure','low match')),
      source text not null check(source in ('pick','search','voice','ai')),
      frame_class text,
      sharpness real not null,
      game_id text not null,
      model_id text not null,
      model_sha256 text not null,
      index_version text not null,
      layout_key text not null,
      space text not null check(space in ('art-box','whole-card')),
      review text not null default 'pending' check(review in ('pending','approved','rejected')),
      reviewed_by integer references users(id) on delete set null,
      reviewed_at integer,
      unique(user_id,fingerprint)
    );
    create index if not exists vision_samples_created_idx on vision_samples(created_at);
    create index if not exists vision_samples_user_idx on vision_samples(user_id);
  `);
}
