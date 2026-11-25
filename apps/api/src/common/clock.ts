/** Injection token for the current time, so expiry logic can be tested without waiting. */
export const CLOCK = Symbol('CLOCK');
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();
