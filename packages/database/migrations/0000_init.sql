-- Initial migration.
-- pgvector backs runbook and incident retrieval (Phase 8). Enabling it now verifies early that
-- every environment's PostgreSQL image ships the extension.
CREATE EXTENSION IF NOT EXISTS vector;
