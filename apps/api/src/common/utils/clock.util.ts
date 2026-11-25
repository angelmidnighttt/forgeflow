import type { Clock } from '../types/clock.types.js';

export const systemClock: Clock = () => new Date();
