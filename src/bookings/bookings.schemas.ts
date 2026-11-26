import { z } from 'zod';

// An instant with an explicit offset, such as 2026-12-01T10:00:00+01:00 or ...Z.
// A local time without one ("10:00 where?") is a 400.
const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

export const createBookingSchema = z
  .object({ resourceId: z.uuid(), startsAt: instant, endsAt: instant })
  .refine((b) => b.endsAt > b.startsAt, { message: 'Must be after startsAt', path: ['endsAt'] });
export type CreateBookingDto = z.infer<typeof createBookingSchema>;
