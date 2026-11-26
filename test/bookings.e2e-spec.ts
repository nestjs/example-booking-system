import { fileURLToPath } from 'node:url';
import { PasswordHasher } from '@nestjs/authentication';
import { getDrizzleToken } from '@nestjs/drizzle';
import { NodeAdapter, type NestNodeApplication } from '@nestjs/platform-node';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module.js';
import { bookings, users } from '../src/database/schema.js';
import type { Role } from '../src/users/user.js';

// A real PostgreSQL with a pool, so concurrent bookings really race.
const url = process.env.TEST_DATABASE_URL;

// Three days from now, in UTC: in the future, and past the cancellation cutoff.
const day = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const at = (time: string) => `${day}T${time}:00Z`;

describe.skipIf(!url)('Booking API (e2e)', () => {
  const db = drizzle({ client: new Pool({ connectionString: url, max: 20 }) });
  let app: NestNodeApplication;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.execute(sql`TRUNCATE users, resources, bookings, refresh_tokens CASCADE`);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDrizzleToken())
      .useValue(db)
      // scrypt at the default cost takes 128 MiB and a few hundred ms per hash.
      .overrideProvider(PasswordHasher)
      .useValue(new PasswordHasher({ logN: 10 }))
      .compile();
    app = moduleRef.createNestApplication<NestNodeApplication>(new NodeAdapter());
    await app.init();
  });

  afterAll(() => app.close()); // closes the pool too

  let clients = 0;

  /** Signs a user up, and returns the headers that authenticate as them. */
  async function signUp(email: string, role: Role = 'customer') {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-up',
      payload: { email, password: 'correct horse battery' },
      // Each user signs up from an address of their own, as they would in
      // production: sign-up is rate-limited per IP address.
      remoteAddress: `10.0.0.${++clients}`,
    });
    await db.update(users).set({ role }).where(eq(users.email, email));
    return { authorization: `Bearer ${res.json<{ accessToken: string }>().accessToken}` };
  }

  /** A room open 08:00 to 18:00 UTC, with one-hour slots. */
  async function createRoom() {
    const res = await app.inject({
      method: 'POST',
      url: '/resources',
      headers: await signUp(`staff-${crypto.randomUUID()}@example.com`, 'staff'),
      payload: { name: 'Room', timeZone: 'UTC', opensAt: '08:00', closesAt: '18:00', slotMinutes: 60 },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string }>().id;
  }

  function book(headers: Record<string, string>, resourceId: string, startsAt: string, endsAt: string) {
    return app.inject({ method: 'POST', url: '/bookings', headers, payload: { resourceId, startsAt, endsAt } });
  }

  function cancel(headers: Record<string, string>, bookingId: string) {
    return app.inject({ method: 'POST', url: `/bookings/${bookingId}/cancel`, headers });
  }

  it('lets only staff create resources', async () => {
    const payload = { name: 'Room', timeZone: 'UTC', opensAt: '08:00', closesAt: '18:00', slotMinutes: 60 };
    const customer = await signUp('customer@example.com');
    expect((await app.inject({ method: 'POST', url: '/resources', payload })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/resources', headers: customer, payload })).statusCode).toBe(403);
  });

  it('books a slot exactly once when ten users race for it', async () => {
    const roomId = await createRoom();
    const racers = await Promise.all(Array.from({ length: 10 }, (_, i) => signUp(`racer${i}@example.com`)));

    const results = await Promise.all(racers.map((headers) => book(headers, roomId, at('10:00'), at('11:00'))));

    expect(results.map((res) => res.statusCode).sort()).toEqual([201, ...Array(9).fill(409)]);
    const rows = await db.select().from(bookings).where(eq(bookings.resourceId, roomId));
    expect(rows).toHaveLength(1);
  });

  it('accepts back-to-back bookings, and refuses overlapping ones', async () => {
    const roomId = await createRoom();
    const headers = await signUp('back-to-back@example.com');

    expect((await book(headers, roomId, at('10:00'), at('11:00'))).statusCode).toBe(201);
    // Ends exactly when the next one starts: the ranges are half-open.
    expect((await book(headers, roomId, at('11:00'), at('12:00'))).statusCode).toBe(201);
    expect((await book(headers, roomId, at('09:00'), at('10:00'))).statusCode).toBe(201);
    // Any overlap, even one minute, is refused.
    expect((await book(headers, roomId, at('11:59'), at('13:00'))).statusCode).toBe(409);

    const availability = await app.inject({ method: 'GET', url: `/resources/${roomId}/availability?date=${day}` });
    const { slots } = availability.json<{ slots: { startsAt: string }[] }>();
    const starts = slots.map((slot) => slot.startsAt.slice(11, 16));
    expect(starts).toEqual(['08:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00']);
  });

  it('frees the slot when a booking is cancelled', async () => {
    const roomId = await createRoom();
    const ada = await signUp('ada@example.com');
    const bob = await signUp('bob@example.com');
    const booking = (await book(ada, roomId, at('14:00'), at('15:00'))).json<{ id: string }>();

    // Someone else's booking is a 404, as if it didn't exist.
    expect((await cancel(bob, booking.id)).statusCode).toBe(404);
    expect((await cancel(ada, booking.id)).json()).toMatchObject({ status: 'cancelled' });
    expect((await cancel(ada, booking.id)).statusCode).toBe(409);

    // The cancelled booking still overlaps, but the constraint only counts confirmed ones.
    expect((await book(bob, roomId, at('14:30'), at('15:30'))).statusCode).toBe(201);
  });

  it('refuses to cancel a booking that starts within the cutoff', async () => {
    const roomId = await createRoom();
    const headers = await signUp('late@example.com');
    const [{ id: userId }] = await db.select({ id: users.id }).from(users).where(eq(users.email, 'late@example.com'));
    // Inserted directly: it starts in an hour, whatever the room's opening hours.
    const [booking] = await db
      .insert(bookings)
      .values({
        resourceId: roomId,
        userId,
        startsAt: new Date(Date.now() + 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      })
      .returning();

    expect((await cancel(headers, booking.id)).statusCode).toBe(409);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row.status).toBe('confirmed');
  });
});
