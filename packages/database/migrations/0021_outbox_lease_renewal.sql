-- A worker keeps the claims of the batch it is handling: without it, an event waiting behind a
-- slow one (or a long catch-up job) would outlive its lease and another worker would take it
-- over and run it again. Renews only the claims the caller still holds (same token), and returns
-- how many that was.
CREATE FUNCTION forgeflow_renew_outbox_leases(
  p_ids uuid[],
  p_lock_tokens uuid[],
  p_lease_seconds integer
) RETURNS integer
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  WITH renewed AS (
    UPDATE public.outbox_events o
       SET locked_until = clock_timestamp() + make_interval(secs => p_lease_seconds)
      FROM unnest(p_ids, p_lock_tokens) AS held(id, lock_token)
     WHERE o.id = held.id AND o.lock_token = held.lock_token AND o.status = 'processing'
    RETURNING 1)
  SELECT count(*)::integer FROM renewed
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION forgeflow_renew_outbox_leases(uuid[], uuid[], integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION forgeflow_renew_outbox_leases(uuid[], uuid[], integer) TO forgeflow_app;
