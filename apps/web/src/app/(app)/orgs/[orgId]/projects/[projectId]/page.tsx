import type { Metadata } from 'next';
import { ProjectView } from '@/features/projects/components/project-view';

export const metadata: Metadata = { title: 'Project' };

export default function ProjectPage() {
  return <ProjectView />;
}
