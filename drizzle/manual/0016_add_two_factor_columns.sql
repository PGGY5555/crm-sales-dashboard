-- =============================================================================
-- Production: add 2FA columns only (safe to run on existing DB)
-- Run this in MySQL if you prefer manual SQL over `pnpm db:migrate`.
-- =============================================================================

ALTER TABLE `users` ADD `twoFactorSecret` varchar(512);
ALTER TABLE `users` ADD `twoFactorEnabled` boolean NOT NULL DEFAULT false;

-- After manual apply, mark migration 0016 as done so Drizzle won't re-run it:
-- INSERT INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES
--   ('c24f2f82e0202d1ab98cd187eb785e2ecb86a00bc0be2838d24ef114b107d95a', 1780735108088);
