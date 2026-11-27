CREATE TABLE "integration_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"source" text NOT NULL,
	"kek_version" integer NOT NULL,
	"wrapped_key" "bytea" NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "integration_secrets_name_check" CHECK ("integration_secrets"."name" ~ '^[a-z][a-z0-9_]{0,62}$'),
	CONSTRAINT "integration_secrets_version_check" CHECK ("integration_secrets"."version" >= 1),
	CONSTRAINT "integration_secrets_source_check" CHECK ("integration_secrets"."source" IN ('generated', 'provided'))
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_organization_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "integrations_status_check" CHECK ("integrations"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "integration_secrets" ADD CONSTRAINT "integration_secrets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_secrets" ADD CONSTRAINT "integration_secrets_integration_fkey" FOREIGN KEY ("organization_id","integration_id") REFERENCES "public"."integrations"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_project_fkey" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_secrets_version_key" ON "integration_secrets" USING btree ("integration_id","name","version");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_secrets_usable_key" ON "integration_secrets" USING btree ("integration_id","name") WHERE "integration_secrets"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_organization_name_key" ON "integrations" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_kind_external_id_key" ON "integrations" USING btree ("kind","external_id") WHERE "integrations"."external_id" IS NOT NULL;