CREATE TYPE "public"."account_status" AS ENUM('active', 'needs_reauth', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('user', 'system', 'n8n');--> statement-breakpoint
CREATE TYPE "public"."asset_kind" AS ENUM('script', 'voiceover', 'visual_plan', 'clip', 'image', 'captions_vtt', 'thumbnail', 'final_video', 'preview');--> statement-breakpoint
CREATE TYPE "public"."decision" AS ENUM('approved', 'rejected', 'changes_requested');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'generating', 'pending_approval', 'changes_requested', 'approved', 'scheduled', 'publishing', 'published', 'partially_published', 'publish_failed', 'rejected', 'generation_failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."ledger_reason" AS ENUM('grant', 'topup', 'reserve', 'release', 'charge', 'refund', 'expire');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'reviewer', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."plan_id" AS ENUM('trial', 'creator', 'pro', 'studio');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('youtube', 'tiktok');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('scheduled', 'publishing', 'published', 'failed', 'needs_reauth', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."stage" AS ENUM('ideation', 'script', 'voiceover', 'visuals', 'captions', 'thumbnail', 'render');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'unpaid');--> statement-breakpoint
CREATE TYPE "public"."video_format" AS ENUM('short', 'long');--> statement-breakpoint
CREATE TYPE "public"."video_tier" AS ENUM('short_standard', 'short_premium', 'long_standard');--> statement-breakpoint
CREATE TYPE "public"."visual_style" AS ENUM('hybrid', 'full_ai');--> statement-breakpoint
CREATE TYPE "public"."webhook_source" AS ENUM('n8n', 'stripe');--> statement-breakpoint
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
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"job_id" text NOT NULL,
	"revision" integer NOT NULL,
	"reviewer_id" text,
	"decision" "decision" NOT NULL,
	"change_targets" text[] DEFAULT '{}'::text[] NOT NULL,
	"feedback" text,
	"credits_cost" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"job_id" text NOT NULL,
	"revision" integer NOT NULL,
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
CREATE TABLE "connected_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"platform" "platform" NOT NULL,
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
	"platform_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_refreshed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_strategies" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"niche" text NOT NULL,
	"audience" text NOT NULL,
	"tone" text NOT NULL,
	"voice_id" text,
	"language" text DEFAULT 'en' NOT NULL,
	"format" "video_format" DEFAULT 'short' NOT NULL,
	"target_length_sec" integer DEFAULT 45 NOT NULL,
	"visual_style" "visual_style" DEFAULT 'hybrid' NOT NULL,
	"tier" "video_tier" DEFAULT 'short_standard' NOT NULL,
	"cadence" text NOT NULL,
	"posting_windows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_account_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"banned_topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"hashtag_seeds" text[] DEFAULT '{}'::text[] NOT NULL,
	"ai_disclosure" boolean DEFAULT true NOT NULL,
	"generate_ahead_days" integer DEFAULT 3 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"reason" "ledger_reason" NOT NULL,
	"credits" integer NOT NULL,
	"available_after" integer NOT NULL,
	"reserved_after" integer NOT NULL,
	"job_id" text,
	"stripe_ref" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"job_id" text NOT NULL,
	"revision" integer NOT NULL,
	"event" text NOT NULL,
	"from_status" "job_status",
	"to_status" "job_status",
	"actor_type" "actor_type" NOT NULL,
	"actor_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_metrics" (
	"post_id" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"views" bigint DEFAULT 0 NOT NULL,
	"likes" bigint DEFAULT 0 NOT NULL,
	"comments" bigint DEFAULT 0 NOT NULL,
	"shares" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "post_metrics_post_id_captured_at_pk" PRIMARY KEY("post_id","captured_at")
);
--> statement-breakpoint
CREATE TABLE "provider_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"job_id" text NOT NULL,
	"revision" integer NOT NULL,
	"stage" "stage",
	"provider" text NOT NULL,
	"model" text,
	"units" real NOT NULL,
	"unit" text NOT NULL,
	"cost_usd" numeric(10, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"job_id" text NOT NULL,
	"connected_account_id" text NOT NULL,
	"platform" "platform" NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" "post_status" DEFAULT 'scheduled' NOT NULL,
	"title" text,
	"caption" text,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"platform_options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"external_post_id" text,
	"external_url" text,
	"last_error" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_posts_idempotencyKey_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"stripe_subscription_id" text,
	"plan" "plan_id" NOT NULL,
	"status" "subscription_status" NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"cancel_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_workspaceId_unique" UNIQUE("workspace_id"),
	CONSTRAINT "subscriptions_stripeSubscriptionId_unique" UNIQUE("stripe_subscription_id")
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
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"strategy_id" text,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"tier" "video_tier" DEFAULT 'short_standard' NOT NULL,
	"topic" text,
	"brief" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"script" jsonb,
	"title" text,
	"caption" text,
	"hashtags" text[] DEFAULT '{}'::text[] NOT NULL,
	"current_stage" "stage",
	"progress" real DEFAULT 0 NOT NULL,
	"rerun_from_stage" "stage",
	"feedback" jsonb,
	"provider_profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"n8n_execution_id" text,
	"dispatched_at" timestamp with time zone,
	"dispatch_attempts" integer DEFAULT 0 NOT NULL,
	"change_request_count" integer DEFAULT 0 NOT NULL,
	"credits_reserved" integer DEFAULT 0 NOT NULL,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 4) DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"last_event_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"source" "webhook_source" NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"outcome" text
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "member_role" DEFAULT 'reviewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"plan" "plan_id" DEFAULT 'trial' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_job_id_video_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."video_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_reviewer_id_user_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_job_id_video_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."video_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_strategies" ADD CONSTRAINT "content_strategies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_job_id_video_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."video_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_video_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."video_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_post_id_scheduled_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."scheduled_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_runs" ADD CONSTRAINT "provider_runs_job_id_video_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."video_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_job_id_video_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."video_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD CONSTRAINT "video_jobs_strategy_id_content_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."content_strategies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_index" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "approvals_job_id_index" ON "approvals" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_job_id_revision_kind_ordinal_index" ON "assets" USING btree ("job_id","revision","kind","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "connected_accounts_workspace_id_platform_external_id_index" ON "connected_accounts" USING btree ("workspace_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "connected_accounts_status_access_expires_at_index" ON "connected_accounts" USING btree ("status","access_expires_at");--> statement-breakpoint
CREATE INDEX "content_strategies_workspace_id_index" ON "content_strategies" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_workspace_id_created_at_index" ON "credit_ledger" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "job_events_job_id_created_at_index" ON "job_events" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_id_read_at_index" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "provider_runs_job_id_index" ON "provider_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "provider_runs_workspace_id_created_at_index" ON "provider_runs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "scheduled_posts_status_scheduled_at_index" ON "scheduled_posts" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "scheduled_posts_workspace_id_scheduled_at_index" ON "scheduled_posts" USING btree ("workspace_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "scheduled_posts_job_id_index" ON "scheduled_posts" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "session_user_id_index" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "video_jobs_workspace_id_status_index" ON "video_jobs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "video_jobs_status_last_event_at_index" ON "video_jobs" USING btree ("status","last_event_at");--> statement-breakpoint
CREATE INDEX "workspace_members_user_id_index" ON "workspace_members" USING btree ("user_id");