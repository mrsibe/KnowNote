CREATE TABLE `library_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`source_uri` text,
	`local_file_path` text,
	`content` text,
	`structure` text,
	`content_hash` text,
	`mime_type` text,
	`file_size` integer,
	`metadata` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `documents` ADD `source_id` text REFERENCES library_sources(id);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_documents_notebook_source` ON `documents` (`notebook_id`,`source_id`);--> statement-breakpoint
-- 数据迁移（#99）：把现有 documents 一次性回填成一比一的 library_sources。
-- 不按标题/路径合并不同来源；id 取 'lib_' || documents.id，保证一一对应、结果确定。
INSERT INTO `library_sources` (`id`, `title`, `type`, `source_uri`, `local_file_path`, `content`, `structure`, `content_hash`, `mime_type`, `file_size`, `metadata`, `created_at`, `updated_at`)
SELECT 'lib_' || `id`, `title`, `type`, `source_uri`, `local_file_path`, `content`, `structure`, `content_hash`, `mime_type`, `file_size`, `metadata`, `created_at`, `updated_at`
FROM `documents`;--> statement-breakpoint
-- 每个 membership 指向它自己的 snapshot；此后重新索引读的就是这份快照。
UPDATE `documents` SET `source_id` = 'lib_' || `id` WHERE `source_id` IS NULL;