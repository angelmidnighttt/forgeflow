import { ErrorCode } from '@forgeflow/contracts';
import { errorMessage } from '@/features/auth/messages';
import { fieldErrorsFrom, type FieldErrors } from '@/features/auth/validation';
import { ApiError } from '@/lib/api-client';

/** Where to show an error of a project or environment form: under a field, or above the form. */
export interface FormErrors {
  fields: FieldErrors;
  form: string | null;
}

/**
 * The errors of a form with a `name` field. A taken name (409 NAME_TAKEN) is shown under that
 * field with `nameTaken`; anything else above the form.
 */
export function formErrorsFrom(error: unknown, nameTaken: string): FormErrors {
  if (error instanceof ApiError && error.code === ErrorCode.NameTaken) {
    return { fields: { name: nameTaken }, form: null };
  }
  return { fields: fieldErrorsFrom(error), form: errorMessage(error) };
}

export const PROJECT_NAME_TAKEN =
  'Organization đã có project tên này (không phân biệt hoa thường).';
export const ENVIRONMENT_NAME_TAKEN =
  'Project đã có environment tên này (không phân biệt hoa thường).';
