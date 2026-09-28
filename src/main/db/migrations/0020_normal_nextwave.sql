CREATE TABLE `ingestion_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`kind` text NOT NULL,
	`stage` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ingestion_runs_document` ON `ingestion_runs` (`document_id`,`started_at`);