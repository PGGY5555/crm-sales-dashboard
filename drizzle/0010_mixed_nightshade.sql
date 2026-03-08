CREATE TABLE `importJobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`userName` varchar(255),
	`fileType` varchar(32) NOT NULL,
	`fileName` varchar(512),
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`totalRows` int DEFAULT 0,
	`processedRows` int DEFAULT 0,
	`successRows` int DEFAULT 0,
	`errorRows` int DEFAULT 0,
	`errorMessage` text,
	`result` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`completedAt` timestamp,
	CONSTRAINT `importJobs_id` PRIMARY KEY(`id`)
);
