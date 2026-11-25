import { SystemStatus } from './system-status';

export default function HomePage() {
  return (
    <main className="page">
      <header className="masthead">
        <p className="eyebrow">ForgeFlow</p>
        <h1>System status</h1>
        <p className="lead">
          Live health of this ForgeFlow deployment. Deployments, incidents and approvals arrive in
          the next releases.
        </p>
      </header>
      <SystemStatus />
    </main>
  );
}
