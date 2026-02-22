CREATE TABLE `dm_calendar_event` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`game_day` integer NOT NULL,
	`category` text DEFAULT 'note' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `dm_campaign`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dm_campaign` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`chat_session_id` text,
	`current_game_day` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dm_consequence` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`session_id` text,
	`action` text NOT NULL,
	`results` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `dm_campaign`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dm_faction` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`reputation` integer DEFAULT 0 NOT NULL,
	`threshold_notes` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `dm_campaign`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dm_item` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`mechanical_properties` text DEFAULT '' NOT NULL,
	`narrative_properties` text DEFAULT '' NOT NULL,
	`origin` text DEFAULT '' NOT NULL,
	`current_holder` text,
	`is_quest_giver` integer DEFAULT false NOT NULL,
	`quest_hooks` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `dm_campaign`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dm_location` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`name` text NOT NULL,
	`location_type` text DEFAULT 'other' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`parent_location_id` text,
	`linked_npc_ids` text DEFAULT '[]' NOT NULL,
	`linked_quest_ids` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `dm_campaign`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dm_npc` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`name` text NOT NULL,
	`race` text,
	`description` text DEFAULT '' NOT NULL,
	`location` text,
	`voice` text DEFAULT '' NOT NULL,
	`temperament` text DEFAULT '' NOT NULL,
	`stance` text DEFAULT 'Neutral' NOT NULL,
	`status_tags` text DEFAULT '[]' NOT NULL,
	`secrets` text DEFAULT '' NOT NULL,
	`rumor_pool` text DEFAULT '[]' NOT NULL,
	`faction_id` text,
	`alive` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `dm_campaign`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dm_party_member` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`player_name` text NOT NULL,
	`character_name` text NOT NULL,
	`race` text,
	`class` text,
	`level` integer DEFAULT 1 NOT NULL,
	`backstory_hooks` text DEFAULT '' NOT NULL,
	`notable_items` text DEFAULT '[]' NOT NULL,
	`relationships` text DEFAULT '' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `dm_campaign`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dm_quest` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`category` text DEFAULT 'active_lead' NOT NULL,
	`deadline` text,
	`urgency` text DEFAULT 'medium' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`related_npc_ids` text DEFAULT '[]' NOT NULL,
	`related_item_ids` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `dm_campaign`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dm_session` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`session_number` integer DEFAULT 1 NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'prep' NOT NULL,
	`prep_content` text,
	`dm_recap` text,
	`player_recap` text,
	`next_session_hooks` text,
	`chat_session_id` text,
	`notes` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`campaign_id`) REFERENCES `dm_campaign`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `dm_source` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`type` text DEFAULT 'paste' NOT NULL,
	`vectorized` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `dm_campaign`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `meal_plan` (
	`id` text PRIMARY KEY NOT NULL,
	`week_start_date` text NOT NULL,
	`meal_count` integer DEFAULT 5 NOT NULL,
	`servings_per_meal` integer DEFAULT 2 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`agent_run_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `meal_plan_recipe` (
	`id` text PRIMARY KEY NOT NULL,
	`meal_plan_id` text NOT NULL,
	`recipe_id` text NOT NULL,
	`day_of_week` integer NOT NULL,
	`meal_type` text DEFAULT 'dinner' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`meal_plan_id`) REFERENCES `meal_plan`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `models_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recipe` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`image_url` text,
	`source_url` text,
	`source` text DEFAULT 'ai' NOT NULL,
	`cuisine` text,
	`prep_time` integer,
	`cook_time` integer,
	`servings` integer DEFAULT 2 NOT NULL,
	`steps` text DEFAULT '[]' NOT NULL,
	`ingredients` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`is_favorite` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shopping_list` (
	`id` text PRIMARY KEY NOT NULL,
	`meal_plan_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`meal_plan_id`) REFERENCES `meal_plan`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shopping_list_item` (
	`id` text PRIMARY KEY NOT NULL,
	`shopping_list_id` text NOT NULL,
	`ingredient_name` text NOT NULL,
	`quantity` text NOT NULL,
	`unit` text,
	`category` text DEFAULT 'other' NOT NULL,
	`checked` integer DEFAULT false NOT NULL,
	`recipe_id` text,
	FOREIGN KEY (`shopping_list_id`) REFERENCES `shopping_list`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipe`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`system_prompt` text NOT NULL,
	`cron_schedule` text NOT NULL,
	`model` text DEFAULT 'moonshotai/kimi-k2.5' NOT NULL,
	`memory_path` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_run_at` integer,
	`last_run_status` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_agent`("id", "name", "description", "system_prompt", "cron_schedule", "model", "memory_path", "enabled", "last_run_at", "last_run_status", "created_at", "updated_at") SELECT "id", "name", "description", "system_prompt", "cron_schedule", "model", "memory_path", "enabled", "last_run_at", "last_run_status", "created_at", "updated_at" FROM `agent`;--> statement-breakpoint
DROP TABLE `agent`;--> statement-breakpoint
ALTER TABLE `__new_agent` RENAME TO `agent`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_name_unique` ON `agent` (`name`);--> statement-breakpoint
CREATE TABLE `__new_chat_session` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT 'New Chat' NOT NULL,
	`model` text DEFAULT 'moonshotai/kimi-k2.5' NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_chat_session`("id", "title", "model", "message_count", "created_at", "updated_at") SELECT "id", "title", "model", "message_count", "created_at", "updated_at" FROM `chat_session`;--> statement-breakpoint
DROP TABLE `chat_session`;--> statement-breakpoint
ALTER TABLE `__new_chat_session` RENAME TO `chat_session`;