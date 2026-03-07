CREATE TABLE `orderItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderId` int,
	`orderExternalId` varchar(128),
	`productName` varchar(512),
	`productSku` varchar(128),
	`productSpec` varchar(255),
	`quantity` int DEFAULT 1,
	`unitPrice` decimal(12,2),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `orderItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`externalId` varchar(128),
	`name` varchar(512),
	`sku` varchar(128),
	`barcode` varchar(128),
	`category` varchar(255),
	`posCategory` varchar(255),
	`status` varchar(64),
	`cost` decimal(12,2),
	`price` decimal(12,2),
	`originalPrice` decimal(12,2),
	`profit` decimal(12,2),
	`stockQuantity` int DEFAULT 0,
	`supplier` varchar(255),
	`tags` text,
	`salesChannel` varchar(255),
	`rawData` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_externalId_unique` UNIQUE(`externalId`)
);
