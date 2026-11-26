import type { Metadata } from 'next';
import { AcceptInvitationView } from '@/features/organizations/components/accept-invitation-view';

// The token is in the URL fragment; keep it out of the Referer of anything this page loads.
export const metadata: Metadata = { title: 'Lời mời tham gia', referrer: 'no-referrer' };

export default function AcceptInvitationPage() {
  return <AcceptInvitationView />;
}
