ALTER TABLE `customers` ADD `birthday` varchar(32);--> statement-breakpoint
ALTER TABLE `customers` ADD `tags` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `memberLevel` varchar(64);--> statement-breakpoint
ALTER TABLE `customers` ADD `credits` decimal(12,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `customers` ADD `lastPurchaseDate` timestamp;--> statement-breakpoint
ALTER TABLE `customers` ADD `lastPurchaseAmount` decimal(12,2);--> statement-breakpoint
ALTER TABLE `customers` ADD `recipientName` varchar(255);--> statement-breakpoint
ALTER TABLE `customers` ADD `recipientPhone` varchar(64);--> statement-breakpoint
ALTER TABLE `customers` ADD `recipientEmail` varchar(320);--> statement-breakpoint
ALTER TABLE `orders` ADD `recipientName` varchar(255);--> statement-breakpoint
ALTER TABLE `orders` ADD `recipientPhone` varchar(64);--> statement-breakpoint
ALTER TABLE `orders` ADD `recipientEmail` varchar(320);--> statement-breakpoint
ALTER TABLE `orders` ADD `orderSource` varchar(128);--> statement-breakpoint
ALTER TABLE `orders` ADD `paymentMethod` varchar(128);--> statement-breakpoint
ALTER TABLE `orders` ADD `shippingMethod` varchar(128);--> statement-breakpoint
ALTER TABLE `orders` ADD `shippingAddress` text;