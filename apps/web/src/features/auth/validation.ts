import { ErrorCode } from '@forgeflow/contracts';
import type { z } from 'zod';
import { ApiError } from '@/lib/api-client';

/** One message per field, in Vietnamese. */
export type FieldErrors = Partial<Record<string, string>>;

/** How each form field is named in messages. */
const FIELD_LABELS: Record<string, string> = {
  email: 'email',
  password: 'mật khẩu',
  currentPassword: 'mật khẩu hiện tại',
  newPassword: 'mật khẩu mới',
  name: 'tên',
  role: 'vai trò',
  token: 'link',
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * A Vietnamese message for a zod issue. The schemas come from @forgeflow/contracts (the same
 * rules the API applies) and carry English messages, so the text is rebuilt from the issue's
 * code and limits instead of using `issue.message`.
 */
function issueMessage(issue: z.core.$ZodIssue, value: unknown): string {
  const field = String(issue.path[0] ?? '');
  const label = FIELD_LABELS[field] ?? 'giá trị';
  const empty = value === undefined || (typeof value === 'string' && value.trim() === '');
  if (empty) return `Nhập ${label}.`;

  switch (issue.code) {
    case 'too_small':
      return `${capitalize(label)} cần ít nhất ${String(issue.minimum)} ký tự.`;
    case 'too_big':
      return `${capitalize(label)} tối đa ${String(issue.maximum)} ký tự.`;
    case 'invalid_format':
      return field === 'email' ? 'Email không hợp lệ.' : `${capitalize(label)} không hợp lệ.`;
    default:
      return `${capitalize(label)} không hợp lệ.`;
  }
}

/** Validates form values with a contracts schema; on failure, the first message per field. */
export function validate<T extends z.ZodType>(
  schema: T,
  values: Record<string, unknown>,
): { ok: true; data: z.output<T> } | { ok: false; errors: FieldErrors } {
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? '');
    errors[field] ??= issueMessage(issue, values[field]);
  }
  return { ok: false, errors };
}

/**
 * Field messages for a VALIDATION_FAILED answer from the API (normally caught by `validate`
 * first). Empty for any other error.
 */
export function fieldErrorsFrom(error: unknown): FieldErrors {
  if (!(error instanceof ApiError) || error.code !== ErrorCode.ValidationFailed) return {};
  if (!Array.isArray(error.details)) return {};
  const errors: FieldErrors = {};
  for (const detail of error.details as Array<{ path?: unknown }>) {
    const field = typeof detail.path === 'string' ? detail.path.split('.')[0] : undefined;
    if (field) errors[field] ??= `${capitalize(FIELD_LABELS[field] ?? 'giá trị')} không hợp lệ.`;
  }
  return errors;
}

/** Checks the "type the new password again" field. */
export function confirmMatches(password: string, confirmation: string): string | undefined {
  if (!confirmation) return 'Nhập lại mật khẩu.';
  return password === confirmation ? undefined : 'Mật khẩu nhập lại không khớp.';
}
