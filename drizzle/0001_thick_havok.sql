CREATE TABLE `patient_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`patient_id` integer NOT NULL,
	`event_type` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`is_invalidated` integer DEFAULT false NOT NULL,
	`invalidated_reason` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_patient_events_patient_id` ON `patient_events` (`patient_id`);--> statement-breakpoint
CREATE INDEX `idx_patient_events_created_at` ON `patient_events` (`created_at`);--> statement-breakpoint
ALTER TABLE `patients` ADD `entry_type` text DEFAULT 'استشارية' NOT NULL;--> statement-breakpoint
ALTER TABLE `patients` ADD `patient_status` text DEFAULT 'نشط' NOT NULL;--> statement-breakpoint
ALTER TABLE `patients` ADD `billing_mode` text DEFAULT 'مقطوعي' NOT NULL;--> statement-breakpoint
ALTER TABLE `patients` ADD `is_newborn` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `patients` ADD `mother_id` integer REFERENCES patients(id);--> statement-breakpoint
ALTER TABLE `patients` ADD `twin_order` integer;--> statement-breakpoint
ALTER TABLE `patients` ADD `discharge_date` text;--> statement-breakpoint
PRAGMA optimize;
