CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"project_id" uuid,
	"external_id" text NOT NULL,
	"full_name" text NOT NULL,
	"html_url" text NOT NULL,
	"default_branch" text,
	"private" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_integration_fkey" FOREIGN KEY ("organization_id","integration_id") REFERENCES "public"."integrations"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_project_fkey" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_integration_external_key" ON "repositories" USING btree ("integration_id","external_id");--> statement-breakpoint
CREATE INDEX "repositories_organization_project_idx" ON "repositories" USING btree ("organization_id","project_id");