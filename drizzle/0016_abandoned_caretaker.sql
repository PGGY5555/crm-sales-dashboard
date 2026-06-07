ALTER TABLE `users` ADD `twoFactorSecret` varchar(512);
--> statement-breakpoint
ALTER TABLE `users` ADD `twoFactorEnabled` boolean DEFAULT false NOT NULL;
