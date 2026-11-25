import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { SuccessBody } from '@forgeflow/contracts';
import { map, type Observable } from 'rxjs';

/** Wraps every successful handler result as `{ data: result }`. */
@Injectable()
export class EnvelopeInterceptor<T> implements NestInterceptor<T, SuccessBody<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<SuccessBody<T>> {
    return next.handle().pipe(map((data) => ({ data })));
  }
}
