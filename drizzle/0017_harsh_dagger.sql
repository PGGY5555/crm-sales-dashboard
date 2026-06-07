CREATE INDEX `customers_registeredAt_idx` ON `customers` (`registeredAt`);--> statement-breakpoint
CREATE INDEX `customers_lastShipmentAt_idx` ON `customers` (`lastShipmentAt`);--> statement-breakpoint
CREATE INDEX `customers_email_idx` ON `customers` (`email`);--> statement-breakpoint
CREATE INDEX `customers_phone_idx` ON `customers` (`phone`);--> statement-breakpoint
CREATE INDEX `customers_lifecycle_idx` ON `customers` (`lifecycle`);--> statement-breakpoint
CREATE INDEX `customers_memberLevel_idx` ON `customers` (`memberLevel`);--> statement-breakpoint
CREATE INDEX `customers_lastPurchaseDate_idx` ON `customers` (`lastPurchaseDate`);--> statement-breakpoint
CREATE INDEX `orderItems_orderId_idx` ON `orderItems` (`orderId`);--> statement-breakpoint
CREATE INDEX `orderItems_orderExternalId_idx` ON `orderItems` (`orderExternalId`);--> statement-breakpoint
CREATE INDEX `orders_orderDate_idx` ON `orders` (`orderDate`);--> statement-breakpoint
CREATE INDEX `orders_customerId_idx` ON `orders` (`customerId`);--> statement-breakpoint
CREATE INDEX `orders_shippedAt_idx` ON `orders` (`shippedAt`);--> statement-breakpoint
CREATE INDEX `orders_shipmentNumber_idx` ON `orders` (`shipmentNumber`);--> statement-breakpoint
CREATE INDEX `orders_customerEmail_idx` ON `orders` (`customerEmail`);--> statement-breakpoint
CREATE INDEX `orders_customerPhone_idx` ON `orders` (`customerPhone`);