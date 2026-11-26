CREATE TABLE IF NOT EXISTS board_posts (
  id TEXT PRIMARY KEY NOT NULL,
  category TEXT NOT NULL,
  nickname TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  hidden INTEGER NOT NULL DEFAULT 0,
  author_id TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  status_updated_at INTEGER
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS board_posts_recent ON board_posts(hidden, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS board_posts_author ON board_posts(author_id, created_at);
