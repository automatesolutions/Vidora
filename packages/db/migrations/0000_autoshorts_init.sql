CREATE TYPE "public"."account_status" AS ENUM('active', 'needs_reauth', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('user', 'system', 'provider');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('script', 'scene_clip', 'voiceover', 'music', 'captions', 'thumbnail', 'final_video', 'input_image');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."credential_status" AS ENUM('unverified', 'valid', 'invalid');--> statement-breakpoint
CREATE TYPE "public"."frequency" AS ENUM('daily', 'weekly', 'three_per_week', 'custom');--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('pending', 'submitted', 'in_progress', 'completed', 'stored', 'failed', 'nsfw', 'canceled', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."pause_reason" AS ENUM('user', 'monthly_cap', 'run_cap', 'low_balance', 'bad_credentials', 'youtube_auth', 'repeated_failures');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('youtube');--> statement-breakpoint
CREATE TYPE "public"."provider_name" AS ENUM('higgsfield');--> statement-breakpoint
CREATE TYPE "public"."publish_mode" AS ENUM('auto', 'approval');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('planned', 'generating', 'assembling', 'awaiting_approval', 'uploading', 'scheduled', 'published', 'failed', 'skipped', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."run_trigger" AS ENUM('schedule', 'run_now');--> statement-breakpoint
CREATE TYPE "public"."spend_kind" AS ENUM('hold', 'release', 'charge');--> statement-breakpoint
CREATE TYPE "public"."upload_purpose" AS ENUM('input', 'logo', 'music');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('pending', 'ready', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."variation_intensity" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."video_mode" AS ENUM('original', 'product', 'ugc', 'clipping');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('generating', 'ready', 'scheduled', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('public', 'unlisted', 'private');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_snapshots" (
	"video_id" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"views" bigint DEFAULT 0 NOT NULL,
	"likes" bigint DEFAULT 0 NOT NULL,
	"comments" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_snapshots_video_id_captured_at_pk" PRIMARY KEY("video_id","captured_at")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"generation_job_id" text,
	"kind" "asset_kind" NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" bigint,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"sha256" text,
	"provider" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_kits" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"logo_upload_id" text,
	"colors" text[] DEFAULT '{}'::text[] NOT NULL,
	"font_family" text,
	"caption_style" text,
	"cta_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_kits_workspaceId_unique" UNIQUE("workspace_id")
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"mode" "video_mode" DEFAULT 'original' NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"pause_reason" "pause_reason",
	"pause_message" text,
	"paused_at" timestamp with time zone,
	"publish_mode" "publish_mode" DEFAULT 'auto' NOT NULL,
	"youtube_account_id" text,
	"brief" jsonb NOT NULL,
	"model_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"variation_intensity" "variation_intensity" DEFAULT 'medium' NOT NULL,
	"locked_elements" text[] DEFAULT '{}'::text[] NOT NULL,
	"locked_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"per_run_cap_usd" numeric(12, 4),
	"monthly_cap_usd" numeric(12, 4),
	"visibility" "visibility" DEFAULT 'public' NOT NULL,
	"made_for_kids" boolean DEFAULT false NOT NULL,
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connected_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"platform" "platform" DEFAULT 'youtube' NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text NOT NULL,
	"handle" text,
	"avatar_url" text,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text,
	"token_key_version" integer DEFAULT 1 NOT NULL,
	"access_expires_at" timestamp with time zone,
	"refresh_expires_at" timestamp with time zone,
	"status" "account_status" DEFAULT 'active' NOT NULL,
	"daily_upload_cap" integer DEFAULT 3 NOT NULL,
	"platform_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text,
	"credential_id" text,
	"provider" "provider_name" DEFAULT 'higgsfield' NOT NULL,
	"model_id" text NOT NULL,
	"scene_index" integer DEFAULT 0 NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"retry_of_id" text,
	"moderation_retries" integer DEFAULT 0 NOT NULL,
	"status" "generation_status" DEFAULT 'pending' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text NOT NULL,
	"input" jsonb NOT NULL,
	"request_id" text,
	"status_url" text,
	"cancel_url" text,
	"provider_status" text,
	"output_url" text,
	"output_kind" text,
	"storage_key" text,
	"bytes" bigint,
	"sha256" text,
	"estimate_credits" numeric(14, 3),
	"estimate_usd" numeric(12, 4),
	"error_kind" text,
	"error_message" text,
	"correlation_id" text,
	"submit_attempts" integer DEFAULT 0 NOT NULL,
	"poll_count" integer DEFAULT 0 NOT NULL,
	"next_check_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"stored_at" timestamp with time zone,
	"deadline_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_jobs_idempotencyKey_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "generation_jobs_requestId_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_registry" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" "provider_name" DEFAULT 'higgsfield' NOT NULL,
	"family" text NOT NULL,
	"display_name" text NOT NULL,
	"workflow" text NOT NULL,
	"output_kind" text NOT NULL,
	"input_schema" jsonb NOT NULL,
	"durations" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"aspect_ratios" text[] DEFAULT '{}'::text[] NOT NULL,
	"resolutions" text[] DEFAULT '{}'::text[] NOT NULL,
	"supports_seed" boolean DEFAULT false NOT NULL,
	"needs_image" boolean DEFAULT false NOT NULL,
	"vertical_from_text" boolean DEFAULT false NOT NULL,
	"docs_url" text NOT NULL,
	"cost_samples" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timeout_sec" integer DEFAULT 1800 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"telegram_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" "provider_name" NOT NULL,
	"secret_enc" text NOT NULL,
	"token_key_version" integer DEFAULT 1 NOT NULL,
	"key_hint" text NOT NULL,
	"status" "credential_status" DEFAULT 'unverified' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_error" text,
	"balance_credits" numeric(14, 3),
	"balance_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"event" text NOT NULL,
	"from_status" "run_status",
	"to_status" "run_status",
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"slot_at" timestamp with time zone NOT NULL,
	"generate_at" timestamp with time zone NOT NULL,
	"trigger" "run_trigger" DEFAULT 'schedule' NOT NULL,
	"status" "run_status" DEFAULT 'planned' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"plan" jsonb,
	"variation" jsonb,
	"estimate_usd" numeric(12, 4),
	"estimate_credits" numeric(14, 3),
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"frequency" "frequency" NOT NULL,
	"days" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"times" text[] DEFAULT '{}'::text[] NOT NULL,
	"time_zone" text DEFAULT 'Asia/Manila' NOT NULL,
	"generate_ahead_hours" integer DEFAULT 24 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedules_campaignId_unique" UNIQUE("campaign_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"active_workspace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "spend_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"campaign_id" text,
	"run_id" text,
	"generation_job_id" text,
	"kind" "spend_kind" NOT NULL,
	"usd" numeric(12, 4) NOT NULL,
	"credits" numeric(14, 3) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"video_id" text NOT NULL,
	"account_id" text,
	"step" text NOT NULL,
	"ok" boolean NOT NULL,
	"http_status" integer,
	"quota_units" integer DEFAULT 0 NOT NULL,
	"youtube_video_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text,
	"purpose" "upload_purpose" NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"status" "upload_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uploads_storageKey_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "variation_fingerprints" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"run_id" text NOT NULL,
	"elements" jsonb NOT NULL,
	"hash" text NOT NULL,
	"hook" text NOT NULL,
	"hook_shingles" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "variation_fingerprints_runId_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"run_id" text NOT NULL,
	"status" "video_status" DEFAULT 'generating' NOT NULL,
	"storage_key" text,
	"thumbnail_key" text,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"bytes" bigint,
	"title" text,
	"description" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"youtube_account_id" text,
	"youtube_video_id" text,
	"youtube_url" text,
	"publish_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"cost_usd" numeric(12, 4) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "videos_runId_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"outcome" text
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "member_role" DEFAULT 'editor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"timezone" text DEFAULT 'Asia/Manila' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "youtube_quota_days" (
	"day" date PRIMARY KEY NOT NULL,
	"units_used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_logo_upload_id_uploads_id_fk" FOREIGN KEY ("logo_upload_id") REFERENCES "public"."uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_youtube_account_id_connected_accounts_id_fk" FOREIGN KEY ("youtube_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_credential_id_provider_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_ledger" ADD CONSTRAINT "spend_ledger_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_ledger" ADD CONSTRAINT "spend_ledger_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_ledger" ADD CONSTRAINT "spend_ledger_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spend_ledger" ADD CONSTRAINT "spend_ledger_generation_job_id_generation_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_logs" ADD CONSTRAINT "upload_logs_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_logs" ADD CONSTRAINT "upload_logs_account_id_connected_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variation_fingerprints" ADD CONSTRAINT "variation_fingerprints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variation_fingerprints" ADD CONSTRAINT "variation_fingerprints_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variation_fingerprints" ADD CONSTRAINT "variation_fingerprints_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_youtube_account_id_connected_accounts_id_fk" FOREIGN KEY ("youtube_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_index" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_run_id_kind_ordinal_index" ON "assets" USING btree ("run_id","kind","ordinal");--> statement-breakpoint
CREATE INDEX "campaigns_workspace_id_status_index" ON "campaigns" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "campaigns_status_next_run_at_index" ON "campaigns" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "connected_accounts_workspace_id_platform_external_id_index" ON "connected_accounts" USING btree ("workspace_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "connected_accounts_status_access_expires_at_index" ON "connected_accounts" USING btree ("status","access_expires_at");--> statement-breakpoint
CREATE INDEX "generation_jobs_status_next_check_at_index" ON "generation_jobs" USING btree ("status","next_check_at");--> statement-breakpoint
CREATE INDEX "generation_jobs_run_id_index" ON "generation_jobs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "generation_jobs_workspace_id_created_at_index" ON "generation_jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "invitation_workspace_id_index" ON "invitation" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "invitation_email_index" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "model_registry_workflow_enabled_index" ON "model_registry" USING btree ("workflow","enabled");--> statement-breakpoint
CREATE INDEX "notifications_workspace_id_created_at_index" ON "notifications" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_id_read_at_index" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_credentials_workspace_id_provider_index" ON "provider_credentials" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE INDEX "run_events_run_id_created_at_index" ON "run_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_campaign_id_slot_at_index" ON "runs" USING btree ("campaign_id","slot_at");--> statement-breakpoint
CREATE INDEX "runs_status_generate_at_index" ON "runs" USING btree ("status","generate_at");--> statement-breakpoint
CREATE INDEX "runs_workspace_id_slot_at_index" ON "runs" USING btree ("workspace_id","slot_at");--> statement-breakpoint
CREATE INDEX "session_user_id_index" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "spend_ledger_generation_job_id_kind_index" ON "spend_ledger" USING btree ("generation_job_id","kind");--> statement-breakpoint
CREATE INDEX "spend_ledger_workspace_id_created_at_index" ON "spend_ledger" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "spend_ledger_campaign_id_created_at_index" ON "spend_ledger" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "upload_logs_video_id_index" ON "upload_logs" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "upload_logs_account_id_created_at_index" ON "upload_logs" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "uploads_workspace_id_created_at_index" ON "uploads" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "variation_fingerprints_campaign_id_hash_index" ON "variation_fingerprints" USING btree ("campaign_id","hash");--> statement-breakpoint
CREATE INDEX "videos_workspace_id_status_created_at_index" ON "videos" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "videos_campaign_id_index" ON "videos" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_index" ON "workspace_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_id_index" ON "workspace_members" USING btree ("user_id");