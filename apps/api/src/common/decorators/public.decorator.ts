import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../constants/metadata-keys.js';

/** Route is reachable without an access token. Every other route requires one. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
