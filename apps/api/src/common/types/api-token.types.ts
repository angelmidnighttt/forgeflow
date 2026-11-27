import type { Request } from 'express';

/** The project an API token acts for, set on the request by ApiTokenGuard. */
export interface ApiTokenContext {
  tokenId: string;
  organizationId: string;
  projectId: string;
}

export type ApiTokenRequest = Request & { apiToken?: ApiTokenContext };
