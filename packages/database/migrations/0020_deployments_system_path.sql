-- Deployments, API tokens and idempotency keys are tenant rows (docs/adr/ADR-0002); two narrow
-- system functions serve the paths without a tenant context: scheduling the GitHub catch-up job
-- for every organization, and finding which project an API token belongs to.
ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE deployments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY deployments_tenant ON deployments
  USING (organization_id = forgeflow_current_organization_id())
  WITH CHECK (organization_id = forgeflow_current_organization_id());
--> statement-breakpoint
ALTER TABLE deployment_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE deployment_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY deployment_events_tenant ON deployment_events
  USING (organization_id = forgeflow_current_organization_id())
  WITH CHECK (organization_id = forgeflow_current_organization_id());
--> statement-breakpoint
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api_tokens FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY api_tokens_tenant ON api_tokens
  USING (organization_id = forgeflow_current_organization_id())
  WITH CHECK (organization_id = forgeflow_current_organization_id());
--> statement-breakpoint
-- Tokens are revoked (revoked_at), never deleted: the history of who could call stays.
REVOKE DELETE, TRUNCATE ON api_tokens FROM forgeflow_app;
--> statement-breakpoint
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY idempotency_keys_tenant ON idempotency_keys
  USING (organization_id = forgeflow_current_organization_id())
  WITH CHECK (organization_id = forgeflow_current_organization_id());
--> statement-breakpoint

-- 1. The worker's scheduler: one github.reconcile event per active GitHub integration that has
--    none waiting yet, so several workers scheduling at once never pile them up.
CREATE FUNCTION forgeflow_enqueue_github_reconcile() RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.outbox_events (organization_id, topic, payload)
  SELECT i.organization_id, 'github.reconcile',
         jsonb_build_object('integrationId', i.id, 'installationId', i.external_id)
    FROM public.integrations i
   WHERE i.kind = 'github' AND i.status = 'active' AND i.external_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.outbox_events e
        WHERE e.topic = 'github.reconcile' AND e.status IN ('pending', 'processing')
          AND e.payload ->> 'integrationId' = i.id::text);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    PERFORM pg_notify('forgeflow_outbox', 'github.reconcile');
  END IF;
  RETURN v_count;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION forgeflow_enqueue_github_reconcile() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION forgeflow_enqueue_github_reconcile() TO forgeflow_app;
--> statement-breakpoint

-- 2. The report API: the token's hash leads to its project, and nothing else. Everything after
--    runs under RLS in that organization.
CREATE FUNCTION forgeflow_api_token_context(p_token_hash text)
  RETURNS TABLE (
    token_id uuid,
    organization_id uuid,
    project_id uuid,
    scopes text[],
    expires_at timestamptz,
    revoked_at timestamptz
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  SELECT t.id, t.organization_id, t.project_id, t.scopes, t.expires_at, t.revoked_at
    FROM public.api_tokens t
   WHERE t.token_hash = p_token_hash
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION forgeflow_api_token_context(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION forgeflow_api_token_context(text) TO forgeflow_app;
