CREATE TABLE `document_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`kind` text NOT NULL,
	`order` integer NOT NULL,
	`page` integer,
	`level` integer,
	`text` text NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`bbox` text,
	`metadata` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_blocks_document_order` ON `document_blocks` (`document_id`,`order`);--> statement-breakpoint
CREATE INDEX `idx_blocks_document_page` ON `document_blocks` (`document_id`,`page`);