import { CircleAlert, CircleCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/** The error of a whole form (as opposed to one field). Renders nothing without a message. */
export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** A success message, with an optional title. */
export function FormSuccess({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <Alert>
      <CircleCheck className="text-emerald-600" />
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
