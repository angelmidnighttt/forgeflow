CREATE TABLE "api_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"resource_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"deployment_id" uuid NOT NULL,
	"status" text NOT NULL,
	"description" text,
	"external_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_events_status_check" CHECK ("deployment_events"."status" IN ('queued', 'in_progress', 'success', 'failure', 'error', 'cancelled', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_id" uuid,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"repository" text,
	"environment_name" text,
	"ref" text,
	"sha" text,
	"version" text,
	"status" text NOT NULL,
	"status_at" timestamp with time zone NOT NULL,
	"description" text,
	"url" text,
	"environment_url" text,
	"creator" text,
	"workflow" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployments_organization_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "deployments_status_check" CHECK ("deployments"."status" IN ('queued', 'in_progress', 'success', 'failure', 'error', 'cancelled', 'inactive')),
	CONSTRAINT "deployments_source_check" CHECK ("deployments"."source" IN ('github', 'api')),
	CONSTRAINT "deployments_kind_check" CHECK ("deployments"."kind" IN ('deployment', 'workflow_run'))
);
--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_organization_id_key" UNIQUE("organization_id","id");
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_project_fkey" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployment_events" ADD CONSTRAINT "deployment_events_deployment_fkey" FOREIGN KEY ("organization_id","deployment_id") REFERENCES "public"."deployments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_fkey" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_environment_fkey" FOREIGN KEY ("organization_id","environment_id") REFERENCES "public"."environments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_tokens_token_hash_key" ON "api_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "api_tokens_project_idx" ON "api_tokens" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_scope_key" ON "idempotency_keys" USING btree ("organization_id","scope","key");--> statement-breakpoint
CREATE UNIQUE INDEX "deployment_events_external_key" ON "deployment_events" USING btree ("deployment_id","external_id") WHERE "deployment_events"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "deployment_events_deployment_idx" ON "deployment_events" USING btree ("deployment_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_source_key" ON "deployments" USING btree ("project_id","source","kind","external_id");--> statement-breakpoint
CREATE INDEX "deployments_project_created_idx" ON "deployments" USING btree ("project_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);