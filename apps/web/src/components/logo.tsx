import { Workflow } from 'lucide-react';
import Link from 'next/link';

/** The ForgeFlow mark and name, linking to the home page. */
export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold">
      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Workflow className="size-4" />
      </span>
      ForgeFlow
    </Link>
  );
}
