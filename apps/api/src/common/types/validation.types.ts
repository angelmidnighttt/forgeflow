/** One entry of `error.details` in a VALIDATION_FAILED response. */
export interface ValidationIssue {
  path: string;
  message: string;
}
