CREATE TABLE `folder_watches` (
	`id` text PRIMARY KEY NOT NULL,
	`notebook_id` text NOT NULL,
	`path` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_folder_watches_notebook_path` ON `folder_watches` (`notebook_id`,`path`);--> statement-breakpoint
ALTER TABLE `documents` ADD `source_state` text DEFAULT 'available' NOT NULL;--> statement-breakpoint
ALTER TABLE `documents` ADD `source_mtime_ms` integer;