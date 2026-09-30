ALTER TABLE `chat_sessions` ADD `title_is_auto` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `last_opened_at` integer;--> statement-breakpoint
CREATE INDEX `idx_sessions_notebook_opened` ON `chat_sessions` (`notebook_id`,`last_opened_at`);