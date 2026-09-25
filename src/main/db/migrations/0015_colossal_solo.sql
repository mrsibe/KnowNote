CREATE TABLE `chunk_blocks` (
	`chunk_id` text NOT NULL,
	`block_id` text NOT NULL,
	`start_in_block` integer NOT NULL,
	`end_in_block` integer NOT NULL,
	PRIMARY KEY(`chunk_id`, `block_id`),
	FOREIGN KEY (`chunk_id`) REFERENCES `chunks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`block_id`) REFERENCES `document_blocks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chunk_blocks_block` ON `chunk_blocks` (`block_id`);--> statement-breakpoint
ALTER TABLE `chunks` ADD `page_start` integer;--> statement-breakpoint
ALTER TABLE `chunks` ADD `page_end` integer;