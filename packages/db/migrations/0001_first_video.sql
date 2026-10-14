CREATE TYPE "public"."creator_kind" AS ENUM('creator', 'business', 'agency');--> statement-breakpoint
CREATE TYPE "public"."upload_purpose" AS ENUM('input', 'logo');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('pending', 'ready', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."video_type" AS ENUM('fact_tip', 'product_showcase', 'photo_to_life', 'quote');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('public', 'unlisted', 'private');--> statement-breakpoint
CREATE TABLE "brand_kits" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"logo_upload_id" text,
	"colors" text[] DEFAULT '{}'::text[] NOT NULL,
	"end_card_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_kits_workspaceId_unique" UNIQUE("workspace_id")
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
ALTER TABLE "workspace_members" DROP CONSTRAINT "workspace_members_workspace_id_user_id_pk";--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_workspace_id" text;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "video_type" "video_type";--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "length_sec" integer;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "credits_base" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "is_free" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "brand_kit_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "visibility" "visibility" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "made_for_kids" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "cover_ordinal" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "video_jobs" ADD COLUMN "planned_post_at" timestamp with time zone;--> statement-breakpoint
-- Hand-edited: existing members get an ID before the primary key is added (Better Auth's member model needs one).
ALTER TABLE "workspace_members" ADD COLUMN "id" text;--> statement-breakpoint
UPDATE "workspace_members" SET "id" = 'mem_' || upper(substr(md5(random()::text || "workspace_id" || "user_id"), 1, 26)) WHERE "id" IS NULL;--> statement-breakpoint
ALTER TABLE "workspace_members" ALTER COLUMN "id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "logo" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "metadata" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "kind" "creator_kind";--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "free_video_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_logo_upload_id_uploads_id_fk" FOREIGN KEY ("logo_upload_id") REFERENCES "public"."uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_workspace_id_index" ON "invitation" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "invitation_email_index" ON "invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "uploads_workspace_id_created_at_index" ON "uploads" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_index" ON "workspace_members" USING btree ("workspace_id","user_id");