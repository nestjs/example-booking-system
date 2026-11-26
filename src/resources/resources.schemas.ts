import { z } from 'zod';

const name = z.string().trim().min(1).max(200);
// Any IANA time zone the runtime knows, such as Europe/Warsaw.
const timeZone = z.string().refine(isTimeZone, 'Unknown time zone');
// A local time of day, HH:MM.
const timeOfDay = z.iso.time({ precision: -1 });
const slotMinutes = z.number().int().min(5).max(480);

export const createResourceSchema = z
  .object({ name, timeZone, opensAt: timeOfDay, closesAt: timeOfDay, slotMinutes })
  .refine((r) => r.opensAt < r.closesAt, { message: 'Must be after opensAt', path: ['closesAt'] });
export type CreateResourceDto = z.infer<typeof createResourceSchema>;

// The time zone and opening hours stay as created: changing them would leave
// existing bookings outside the hours.
export const updateResourceSchema = z.object({ name, slotMinutes, active: z.boolean() }).partial();
export type UpdateResourceDto = z.infer<typeof updateResourceSchema>;

export const availabilityQuerySchema = z.object({
  // A day in the resource's time zone.
  date: z.iso.date(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

function isTimeZone(value: string): boolean {
  // Names only: PostgreSQL reads an offset such as +01:00 the POSIX way, with the sign flipped.
  if (/^[+-]/.test(value)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
