import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, time, timestamp, uuid } from 'drizzle-orm/pg-core';

// timestamptz: an instant, stored in UTC, whatever offset the client sent.
const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['customer', 'staff'] }).notNull().default('customer'),
  createdAt: at('created_at').notNull().defaultNow(),
});

export const resources = pgTable(
  'resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    // The IANA time zone of the opening hours, such as Europe/Warsaw.
    timeZone: text('time_zone').notNull(),
    // Local times of day, in `timeZone`.
    opensAt: time('opens_at').notNull(),
    closesAt: time('closes_at').notNull(),
    // The length of the slots that availability lists.
    slotMinutes: integer('slot_minutes').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (table) => [check('resources_opens_before_closes', sql`${table.opensAt} < ${table.closesAt}`)],
);

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // The booking is the half-open range [startsAt, endsAt).
    startsAt: at('starts_at').notNull(),
    endsAt: at('ends_at').notNull(),
    status: text('status', { enum: ['confirmed', 'cancelled'] }).notNull().default('confirmed'),
    createdAt: at('created_at').notNull().defaultNow(),
    cancelledAt: at('cancelled_at'),
  },
  (table) => [
    check('bookings_ends_after_starts', sql`${table.endsAt} > ${table.startsAt}`),
    index('bookings_user_id_starts_at_idx').on(table.userId, table.startsAt),
    // The exclusion constraint that prevents double bookings is in a custom migration.
  ],
);

// What @nestjs/authentication keeps for refresh tokens, stored by their SHA-256.
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id').notNull(),
    userId: text('user_id').notNull(),
    createdAt: at('created_at').notNull(),
    expiresAt: at('expires_at').notNull(),
    familyExpiresAt: at('family_expires_at').notNull(),
    usedAt: at('used_at'),
    // A family is revoked when any of its tokens is.
    revoked: boolean('revoked').notNull().default(false),
    claims: jsonb('claims').$type<Record<string, unknown>>(),
  },
  (table) => [
    index('refresh_tokens_family_id_idx').on(table.familyId),
    index('refresh_tokens_user_id_idx').on(table.userId),
    index('refresh_tokens_family_expires_at_idx').on(table.familyExpiresAt),
  ],
);

export type Resource = typeof resources.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
