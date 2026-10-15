ALTER TYPE "public"."provider_name" ADD VALUE 'higgsfield_mcp';--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "account_plan" text;