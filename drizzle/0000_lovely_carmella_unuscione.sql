CREATE TABLE `user_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`state_json` text NOT NULL,
	`api_key_cipher` text,
	`updated_at` integer NOT NULL
);
