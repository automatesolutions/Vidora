ALTER TABLE "campaigns" ADD COLUMN "per_run_cap_credits" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "monthly_cap_credits" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "next_check_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "step_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "runs_status_next_check_at_index" ON "runs" USING btree ("status","next_check_at");