CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"lock_token" uuid,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "outbox_events_status_check" CHECK ("outbox_events"."status" IN ('pending', 'processing', 'done', 'dead'))
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"delivery_id" text NOT NULL,
	"event" text NOT NULL,
	"action" text,
	"installation_id" text,
	"organization_id" uuid,
	"integration_id" uuid,
	"outbox_event_id" uuid,
	"received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_outbox_event_id_outbox_events_id_fk" FOREIGN KEY ("outbox_event_id") REFERENCES "public"."outbox_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_events_claimable_idx" ON "outbox_events" USING btree ("available_at") WHERE "outbox_events"."status" IN ('pending', 'processing');--> statement-breakpoint
CREATE INDEX "outbox_events_organization_status_idx" ON "outbox_events" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_provider_delivery_key" ON "webhook_deliveries" USING btree ("provider","delivery_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_integration_received_idx" ON "webhook_deliveries" USING btree ("integration_id","received_at" DESC NULLS LAST);