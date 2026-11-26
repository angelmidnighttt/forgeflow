import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/** A form's submit button: disabled with a spinner while the request runs. */
export function SubmitButton({
  pending,
  children,
  ...props
}: ComponentProps<typeof Button> & { pending: boolean }) {
  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? <Spinner /> : null}
      {children}
    </Button>
  );
}
