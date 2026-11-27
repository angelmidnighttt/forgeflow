import type {
  Integration,
  IntegrationKind,
  IntegrationSecret,
  RotatedIntegrationSecret,
} from '@forgeflow/contracts';

/** A secret to store with a new integration: made up by ForgeFlow, or given by the user. */
export type NewSecret =
  { name: string; source: 'generated' } | { name: string; source: 'provided'; value: string };

/** An integration to create (by the flow that connects it: GitHub installation, …). */
export interface NewIntegration {
  kind: IntegrationKind;
  name: string;
  projectId?: string | null;
  config?: Record<string, unknown>;
  externalId?: string | null;
  secrets?: NewSecret[];
}

/** The new integration, with the values of its generated secrets, to show once. */
export interface CreatedIntegration {
  integration: Integration;
  generated: Record<string, string>;
}

export type RotateSecretOutcome =
  | ({ status: 'rotated' } & RotatedIntegrationSecret)
  /** No integration with that id in the organization, or no secret with that name. */
  | { status: 'integration_not_found' | 'secret_not_found' }
  /** A provided secret needs its new value; a generated one takes none. */
  | { status: 'value_required' | 'value_not_allowed' };

export type RevokeSecretOutcome =
  | { status: 'revoked'; secret: IntegrationSecret }
  | { status: 'already_revoked' | 'integration_not_found' | 'secret_not_found' };
