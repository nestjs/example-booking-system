import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isExclusionViolation } from '../database/errors.js';
import { bookings, resources, type Booking } from '../database/schema.js';
import type { CreateBookingDto } from './bookings.schemas.js';

/** How long before its start a booking can still be cancelled. */
const CANCELLATION_CUTOFF = '24 hours';

@Injectable()
export class BookingsService {
  constructor(@InjectDrizzle() private readonly db: NodePgDatabase) {}

  async create(userId: string, { resourceId, startsAt, endsAt }: CreateBookingDto): Promise<Booking> {
    // A time of day in the resource's time zone.
    const local = (instant: Date) => sql`(${instant}::timestamptz AT TIME ZONE ${resources.timeZone})`;
    try {
      // One statement: inserts the booking only if the resource is active and the
      // booking fits its opening hours. The exclusion constraint does the rest.
      const [booking] = await this.db
        .insert(bookings)
        .select((qb) =>
          qb
            .select({
              resourceId: resources.id,
              userId: sql`${userId}::uuid`.as('user_id'),
              startsAt: sql`${startsAt}::timestamptz`.as('starts_at'),
              endsAt: sql`${endsAt}::timestamptz`.as('ends_at'),
            })
            .from(resources)
            .where(
              and(
                eq(resources.id, resourceId),
                eq(resources.active, true),
                sql`${startsAt}::timestamptz > now()`,
                sql`${local(startsAt)}::date = ${local(endsAt)}::date`,
                sql`${local(startsAt)}::time >= ${resources.opensAt}`,
                sql`${local(endsAt)}::time <= ${resources.closesAt}`,
              ),
            )
            // Locks the resource's row: bookings of one resource take turns.
            .for('no key update'),
        )
        .returning();
      return booking ?? (await this.refuseBooking(resourceId));
    } catch (error) {
      if (isExclusionViolation(error, 'bookings_no_overlap')) {
        throw new ConflictException('The resource is already booked at that time');
      }
      throw error;
    }
  }

  findUpcoming(userId: string): Promise<Booking[]> {
    return this.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.userId, userId), gt(bookings.endsAt, sql`now()`)))
      .orderBy(asc(bookings.startsAt))
      .limit(100);
  }

  async findOne(userId: string, id: string): Promise<Booking> {
    const [booking] = await this.db.select().from(bookings).where(this.owned(userId, id));
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    return booking;
  }

  /** The owner cancels a confirmed booking, up to the cutoff before it starts. */
  async cancel(userId: string, id: string): Promise<Booking> {
    // Conditional, and on the database's clock: of two cancellations, or one at
    // the moment of the cutoff, the WHERE clause decides.
    const [booking] = await this.db
      .update(bookings)
      .set({ status: 'cancelled', cancelledAt: sql`now()` })
      .where(
        and(
          this.owned(userId, id),
          eq(bookings.status, 'confirmed'),
          sql`${bookings.startsAt} > now() + ${CANCELLATION_CUTOFF}::interval`,
        ),
      )
      .returning();
    return booking ?? (await this.refuseCancel(userId, id));
  }

  private owned(userId: string, id: string) {
    return and(eq(bookings.id, id), eq(bookings.userId, userId));
  }

  /** Why the insert added no row: 404 for an unknown resource, 422 for times that don't fit. */
  private async refuseBooking(resourceId: string): Promise<never> {
    const [resource] = await this.db
      .select({ id: resources.id })
      .from(resources)
      .where(and(eq(resources.id, resourceId), eq(resources.active, true)));
    if (!resource) {
      throw new NotFoundException('Resource not found');
    }
    throw new UnprocessableEntityException('A booking must start in the future, within the opening hours of one day');
  }

  /** Why the cancellation changed nothing: 404 if the booking isn't theirs, 409 otherwise. */
  private async refuseCancel(userId: string, id: string): Promise<never> {
    const { status } = await this.findOne(userId, id);
    if (status === 'cancelled') {
      throw new ConflictException('Booking is already cancelled');
    }
    throw new ConflictException(`Bookings can't be cancelled less than ${CANCELLATION_CUTOFF} before they start`);
  }
}
