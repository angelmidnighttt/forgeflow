import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { sessionSchema, type Session } from '@forgeflow/contracts';
import { z } from 'zod';
import { createApp } from '../../../src/app.factory.js';
import {
  bearer,
  cookieLine,
  cookieValue,
  envFor,
  loginUser,
  registerUser,
  setCookieLines,
  type SignedIn,
  client,
} from '../../support/http.js';

let app: INestApplication;
const http = () => client(app);

beforeAll(async () => {
  app = await createApp(envFor());
  await app.init();
});

afterAll(async () => {
  await app.close();
});

async function sessionsSeenBy(user: SignedIn, cookie = user.refreshCookie): Promise<Session[]> {
  const res = await http()
    .get('/api/v1/auth/sessions')
    .set('Authorization', bearer(user))
    .set('Cookie', cookie)
    .expect(200);
  return z.array(sessionSchema).parse(res.body.data);
}

const refresh = (cookie: string) => http().post('/api/v1/auth/refresh').set('Cookie', cookie);

describe('signed-in devices', () => {
  it('lists one session per sign-in and marks the one of this browser', async () => {
    const laptop = await registerUser(app);
    const phone = await loginUser(app, laptop.email);

    const sessions = await sessionsSeenBy(laptop);
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);

    const fromPhone = await sessionsSeenBy(phone);
    const phoneCurrent = fromPhone.find((s) => s.current);
    const laptopCurrent = sessions.find((s) => s.current);
    expect(phoneCurrent?.id).not.toBe(laptopCurrent?.id);
  });

  it('keeps the sign-in time across refreshes and updates the last use', async () => {
    const user = await registerUser(app);
    const [before] = await sessionsSeenBy(user);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const res = await refresh(user.refreshCookie).set('User-Agent', 'Phone browser/2').expect(200);
    const newCookie = `ff_refresh=${cookieValue(setCookieLines(res), 'ff_refresh')}`;
    const [after] = await sessionsSeenBy(user, newCookie);

    expect(after?.id).toBe(before?.id);
    expect(after?.current).toBe(true);
    expect(after?.signedInAt).toBe(before?.signedInAt);
    expect(Date.parse(after?.lastUsedAt ?? '')).toBeGreaterThan(
      Date.parse(before?.lastUsedAt ?? ''),
    );
    expect(after?.userAgent).toBe('Phone browser/2');
  });

  it('signs out another device by its id', async () => {
    const laptop = await registerUser(app);
    const phone = await loginUser(app, laptop.email);
    const phoneSession = (await sessionsSeenBy(phone)).find((s) => s.current);

    await http()
      .delete(`/api/v1/auth/sessions/${phoneSession?.id}`)
      .set('Authorization', bearer(laptop))
      .set('Cookie', laptop.refreshCookie)
      .expect(204);

    await refresh(phone.refreshCookie).expect(401);
    await refresh(laptop.refreshCookie).expect(200);
  });

  it('removes the cookie when a browser signs out its own session', async () => {
    const user = await registerUser(app);
    const [own] = await sessionsSeenBy(user);
    const res = await http()
      .delete(`/api/v1/auth/sessions/${own?.id}`)
      .set('Authorization', bearer(user))
      .set('Cookie', user.refreshCookie)
      .expect(204);

    expect(cookieLine(setCookieLines(res), 'ff_refresh')).toMatch(/Expires=Thu, 01 Jan 1970/);
    await refresh(user.refreshCookie).expect(401);
  });

  it("cannot sign out another user's session", async () => {
    const alice = await registerUser(app);
    const bob = await registerUser(app);
    const [bobSession] = await sessionsSeenBy(bob);

    const res = await http()
      .delete(`/api/v1/auth/sessions/${bobSession?.id}`)
      .set('Authorization', bearer(alice))
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    await refresh(bob.refreshCookie).expect(200);
  });

  it('answers 404 for an unknown id and 400 for one that is not a UUID', async () => {
    const user = await registerUser(app);
    await http()
      .delete(`/api/v1/auth/sessions/${randomUUID()}`)
      .set('Authorization', bearer(user))
      .expect(404);
    const res = await http()
      .delete('/api/v1/auth/sessions/not-a-uuid')
      .set('Authorization', bearer(user))
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('signs out every other device and keeps this one', async () => {
    const laptop = await registerUser(app);
    const phone = await loginUser(app, laptop.email);
    const tablet = await loginUser(app, laptop.email);

    await http()
      .post('/api/v1/auth/sessions/revoke-others')
      .set('Authorization', bearer(laptop))
      .set('Cookie', laptop.refreshCookie)
      .expect(204);

    await refresh(phone.refreshCookie).expect(401);
    await refresh(tablet.refreshCookie).expect(401);
    const res = await refresh(laptop.refreshCookie).expect(200);
    const newCookie = `ff_refresh=${cookieValue(setCookieLines(res), 'ff_refresh')}`;
    expect(await sessionsSeenBy(laptop, newCookie)).toHaveLength(1);
  });

  it('hides sessions that ended', async () => {
    const user = await registerUser(app);
    const other = await loginUser(app, user.email);
    await http().post('/api/v1/auth/logout').set('Cookie', other.refreshCookie).expect(204);

    const sessions = await sessionsSeenBy(user);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.current).toBe(true);
  });

  it('needs a signed-in user', async () => {
    await http().get('/api/v1/auth/sessions').expect(401);
    await http().post('/api/v1/auth/sessions/revoke-others').expect(401);
  });
});
