CREATE TABLE `notebook_embedding_spaces` (
	`notebook_id` text PRIMARY KEY NOT NULL,
	`space_id` text NOT NULL,
	`backend` text NOT NULL,
	`model` text NOT NULL,
	`revision` text DEFAULT '' NOT NULL,
	`dimensions` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`notebook_id`) REFERENCES `notebooks`(`id`) ON UPDATE no action ON DELETE cascade
);
