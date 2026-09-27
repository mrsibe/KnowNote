ALTER TABLE `chat_messages` ADD `status` text;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `finish_reason` text;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `error` text;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `usage` text;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `finished_at` integer;