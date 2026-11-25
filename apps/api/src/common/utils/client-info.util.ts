import type { Request } from 'express';
import type { ClientInfo } from '../types/auth.types.js';

export function clientInfoFrom(req: Request): ClientInfo {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ip };
}
