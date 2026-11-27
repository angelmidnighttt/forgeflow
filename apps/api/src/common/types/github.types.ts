/** A repository as GitHub's API and webhooks describe it (the fields ForgeFlow keeps). */
export interface GithubRepository {
  id: number;
  full_name: string;
  /** Missing in installation_repositories webhooks. */
  html_url?: string;
  default_branch?: string | null;
  private: boolean;
}

/** An installation of the App as GET /user/installations lists it. */
export interface GithubInstallation {
  id: number;
  account: { login: string; type: string; html_url?: string } | null;
  html_url?: string;
}

/** A deployment from the REST API or a `deployment` webhook. */
export interface GithubDeployment {
  id: number;
  sha: string;
  ref: string;
  environment: string;
  description?: string | null;
  creator?: { login: string } | null;
  created_at: string;
  updated_at?: string;
}

/** A deployment status from the REST API or a `deployment_status` webhook. */
export interface GithubDeploymentStatus {
  id: number;
  state: string;
  description?: string | null;
  environment_url?: string | null;
  log_url?: string | null;
  target_url?: string | null;
  creator?: { login: string } | null;
  created_at: string;
}

/** A GitHub Actions run from the REST API or a `workflow_run` webhook. */
export interface GithubWorkflowRun {
  id: number;
  name?: string | null;
  head_branch?: string | null;
  head_sha: string;
  status: string;
  conclusion?: string | null;
  html_url: string;
  run_number?: number;
  event?: string;
  actor?: { login: string } | null;
  triggering_actor?: { login: string } | null;
  created_at: string;
  run_started_at?: string | null;
  updated_at: string;
}

/** The claims of the signed `state` that ties a GitHub App installation to its organization. */
export interface GithubInstallState {
  organizationId: string;
  userId: string;
  nonce: string;
}
