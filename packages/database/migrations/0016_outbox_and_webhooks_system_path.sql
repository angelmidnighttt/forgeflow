-- Outbox and webhook deliveries (docs/adr/ADR-0003): row-level security for the tenant side,
-- and the narrow "system" functions (docs/adr/ADR-0002) for the two paths that have no tenant
-- context: a webhook arriving (its organization is known only from the installation) and the
-- worker claiming events of every organization.

-- 1. Tenants see their own rows (integrations page: recent deliveries, dead events).
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY webhook_deliveries_tenant_read ON webhook_deliveries FOR SELECT
  USING (organization_id = forgeflow_current_organization_id());
--> statement-breakpoint
-- Deliveries are written only by forgeflow_record_webhook_delivery().
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON webhook_deliveries FROM forgeflow_app;
--> statement-breakpoint
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- A tenant transaction may enqueue work for its organization and send a dead event back.
CREATE POLICY outbox_events_tenant ON outbox_events
  USING (organization_id = forgeflow_current_organization_id())
  WITH CHECK (organization_id = forgeflow_current_organization_id());
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON outbox_events FROM forgeflow_app;
--> statement-breakpoint

-- 2. A webhook arrives: record it once and enqueue its handling, in one transaction. A
--    redelivery (same provider and delivery id) adds nothing. The organization comes from the
--    integration whose external id is the installation, when one is linked.
CREATE FUNCTION forgeflow_record_webhook_delivery(
  p_provider text,
  p_delivery_id text,
  p_event text,
  p_action text,
  p_installation_id text,
  p_payload jsonb
) RETURNS TABLE (delivery_id uuid, created boolean)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
-- The output column delivery_id has the name of a table column: column references win.
#variable_conflict use_column
DECLARE
  v_organization uuid;
  v_integration uuid;
  v_delivery uuid;
  v_event uuid;
BEGIN
  SELECT i.organization_id, i.id INTO v_organization, v_integration
    FROM public.integrations i
   WHERE i.kind = p_provider AND i.external_id = p_installation_id;

  INSERT INTO public.webhook_deliveries
      (provider, delivery_id, event, action, installation_id, organization_id, integration_id)
    VALUES
      (p_provider, p_delivery_id, p_event, p_action, p_installation_id, v_organization, v_integration)
    ON CONFLICT (provider, delivery_id) DO NOTHING
    RETURNING id INTO v_delivery;

  IF v_delivery IS NULL THEN
    RETURN QUERY
      SELECT d.id, false FROM public.webhook_deliveries d
       WHERE d.provider = p_provider AND d.delivery_id = p_delivery_id;
    RETURN;
  END IF;

  INSERT INTO public.outbox_events (organization_id, topic, payload)
    VALUES (
      v_organization,
      p_provider || '.webhook',
      jsonb_build_object(
        'deliveryId', v_delivery,
        'event', p_event,
        'action', p_action,
        'installationId', p_installation_id,
        'integrationId', v_integration,
        'body', p_payload
      )
    )
    RETURNING id INTO v_event;
  UPDATE public.webhook_deliveries SET outbox_event_id = v_event WHERE id = v_delivery;
  PERFORM pg_notify('forgeflow_outbox', p_provider || '.webhook');
  RETURN QUERY SELECT v_delivery, true;
END
$$;
--> statement-breakpoint

-- 3. The worker claims due events of every organization, among the topics it handles: pending
--    ones whose time has come, and processing ones whose lease ran out (their worker died).
--    Each claim gets a new fencing token and counts as an attempt. SKIP LOCKED: two workers
--    never claim the same event.
CREATE FUNCTION forgeflow_claim_outbox_events(
  p_topics text[],
  p_limit integer,
  p_lease_seconds integer
)
  RETURNS SETOF public.outbox_events
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  UPDATE public.outbox_events o
     SET status = 'processing',
         attempts = o.attempts + 1,
         lock_token = gen_random_uuid(),
         locked_until = clock_timestamp() + make_interval(secs => p_lease_seconds)
   WHERE o.id IN (
     SELECT e.id FROM public.outbox_events e
      WHERE e.topic = ANY (p_topics)
        AND ((e.status = 'pending' AND e.available_at <= clock_timestamp())
          OR (e.status = 'processing' AND e.locked_until < clock_timestamp()))
      ORDER BY e.available_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED)
  RETURNING o.*
$$;
--> statement-breakpoint

-- 4. The holder of a claim reports the outcome. Without the current token (the lease ran out
--    and another worker claimed the event) nothing changes and false comes back.
CREATE FUNCTION forgeflow_complete_outbox_event(p_id uuid, p_lock_token uuid)
  RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  WITH done AS (
    UPDATE public.outbox_events
       SET status = 'done', processed_at = clock_timestamp(), lock_token = NULL,
           locked_until = NULL, last_error = NULL
     WHERE id = p_id AND lock_token = p_lock_token AND status = 'processing'
    RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM done)
$$;
--> statement-breakpoint
-- p_retry_at null: give up (dead); otherwise try again from then.
CREATE FUNCTION forgeflow_fail_outbox_event(
  p_id uuid,
  p_lock_token uuid,
  p_error text,
  p_retry_at timestamptz
) RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  WITH failed AS (
    UPDATE public.outbox_events
       SET status = CASE WHEN p_retry_at IS NULL THEN 'dead' ELSE 'pending' END,
           available_at = COALESCE(p_retry_at, available_at),
           last_error = left(p_error, 2000),
           lock_token = NULL,
           locked_until = NULL
     WHERE id = p_id AND lock_token = p_lock_token AND status = 'processing'
    RETURNING 1)
  SELECT EXISTS (SELECT 1 FROM failed)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION forgeflow_record_webhook_delivery(text, text, text, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION forgeflow_record_webhook_delivery(text, text, text, text, text, jsonb) TO forgeflow_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION forgeflow_claim_outbox_events(text[], integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION forgeflow_claim_outbox_events(text[], integer, integer) TO forgeflow_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION forgeflow_complete_outbox_event(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION forgeflow_complete_outbox_event(uuid, uuid) TO forgeflow_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION forgeflow_fail_outbox_event(uuid, uuid, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION forgeflow_fail_outbox_event(uuid, uuid, text, timestamptz) TO forgeflow_app;
