ALTER TABLE `customers` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `blacklisted` varchar(16) DEFAULT '否';--> statement-breakpoint
ALTER TABLE `customers` ADD `lineUid` varchar(255);