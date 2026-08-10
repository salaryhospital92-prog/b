CREATE TABLE `employees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`full_name` text NOT NULL,
	`employee_number` text NOT NULL,
	`username` text NOT NULL,
	`phone` text,
	`role` text NOT NULL,
	`specialty` text NOT NULL,
	`join_date` text NOT NULL,
	`max_consultations` integer,
	`daily_cap` integer,
	`status` text DEFAULT 'نشط' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employees_employee_number_unique` ON `employees` (`employee_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `employees_username_unique` ON `employees` (`username`);--> statement-breakpoint
CREATE INDEX `idx_employees_created_at` ON `employees` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_employees_role` ON `employees` (`role`);--> statement-breakpoint
CREATE TABLE `patients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`full_name` text NOT NULL,
	`file_number` text NOT NULL,
	`birth_date` text,
	`gender` text NOT NULL,
	`phone` text,
	`admission_date` text NOT NULL,
	`department` text NOT NULL,
	`attending_doctor` text,
	`payment_category` text DEFAULT 'نقدي' NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patients_file_number_unique` ON `patients` (`file_number`);--> statement-breakpoint
CREATE INDEX `idx_patients_created_at` ON `patients` (`created_at`);--> statement-breakpoint
PRAGMA optimize;
