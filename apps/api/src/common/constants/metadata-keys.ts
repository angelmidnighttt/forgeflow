/** Set by @Public(); read by JwtAuthGuard. */
export const IS_PUBLIC_KEY = 'forgeflow:public';

/** Set by @RateLimit(); read by RateLimitGuard. */
export const RATE_LIMIT_KEY = 'forgeflow:rate-limit';

/** Set by @RequirePermission(); read by OrgPermissionGuard. */
export const REQUIRED_PERMISSION_KEY = 'forgeflow:required-permission';
