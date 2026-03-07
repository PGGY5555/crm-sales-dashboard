CREATE TABLE `customers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`externalId` varchar(128) NOT NULL,
	`name` varchar(255),
	`email` varchar(320),
	`phone` varchar(64),
	`registeredAt` timestamp,
	`lastShipmentAt` timestamp,
	`totalOrders` int NOT NULL DEFAULT 0,
	`totalSpent` decimal(12,2) NOT NULL DEFAULT '0',
	`lifecycle` enum('N','A','S','L','D','O') DEFAULT 'O',
	`avgRepurchaseDays` int,
	`rawData` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customers_id` PRIMARY KEY(`id`),
	CONSTRAINT `customers_externalId_unique` UNIQUE(`externalId`)
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`externalId` varchar(128) NOT NULL,
	`cartToken` varchar(128),
	`customerId` int,
	`customerExternalId` varchar(128),
	`customerName` varchar(255),
	`customerEmail` varchar(320),
	`customerPhone` varchar(64),
	`orderStatus` int DEFAULT 0,
	`progress` varchar(64),
	`total` decimal(12,2) DEFAULT '0',
	`shipmentFee` decimal(10,2) DEFAULT '0',
	`salesRep` varchar(255),
	`isShipped` boolean DEFAULT false,
	`shippedAt` timestamp,
	`archived` boolean DEFAULT false,
	`orderDate` timestamp,
	`rawData` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `orders_externalId_unique` UNIQUE(`externalId`)
);
--> statement-breakpoint
CREATE TABLE `syncLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`syncType` varchar(64) NOT NULL,
	`status` enum('running','success','failed') NOT NULL DEFAULT 'running',
	`recordsProcessed` int DEFAULT 0,
	`errorMessage` text,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `syncLogs_id` PRIMARY KEY(`id`)
);
