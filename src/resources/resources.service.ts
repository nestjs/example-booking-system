import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDrizzle } from '@nestjs/drizzle';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { bookings, resources, type Resource } from '../database/schema.js';
import type { CreateResourceDto, UpdateResourceDto } from './resources.schemas.js';

export interface Slot {
  startsAt: Date;
  endsAt: Date;
}

@Injectable()
export class ResourcesService {
  constructor(@InjectDrizzle() private readonly db: NodePgDatabase) {}

  findAll(): Promise<Resource[]> {
    return this.db.select().from(resources).where(eq(resources.active, true)).orderBy(asc(resources.name)).limit(100);
  }

  async findOne(id: string): Promise<Resource> {
    const [resource] = await this.db
      .select()
      .from(resources)
      .where(and(eq(resources.id, id), eq(resources.active, true)));
    return resource ?? notFound();
  }

  async create(dto: CreateResourceDto): Promise<Resource> {
    const [resource] = await this.db.insert(resources).values(dto).returning();
    return resource;
  }

  async update(id: string, dto: UpdateResourceDto): Promise<Resource> {
    const [resource] = await this.db.update(resources).set(dto).where(eq(resources.id, id)).returning();
    return resource ?? notFound();
  }

  /** The free slots of one day, in the resource's time zone, that haven't started yet. */
  async availability(id: string, date: string): Promise<Slot[]> {
    const { timeZone, opensAt, closesAt, slotMinutes } = await this.findOne(id);
    const length = sql`make_interval(mins => ${slotMinutes})`;
    // The day's opening and closing times, as instants. AT TIME ZONE applies the
    // offset that is valid on that date, so a day with a DST change is right too.
    const opens = sql`(${date}::date + ${opensAt}::time) AT TIME ZONE ${timeZone}`;
    const closes = sql`(${date}::date + ${closesAt}::time) AT TIME ZONE ${timeZone}`;
    const slot = sql`slot`;

    return this.db
      .select({
        startsAt: sql`${slot}`.mapWith(bookings.startsAt),
        endsAt: sql`${slot} + ${length}`.mapWith(bookings.endsAt),
      })
      .from(sql`generate_series(${opens}, ${closes} - ${length}, ${length}) AS slot`)
      .where(
        and(
          sql`${slot} > now()`,
          // The same rule as the exclusion constraint: confirmed bookings, half-open ranges.
          sql`NOT EXISTS (
            SELECT 1 FROM ${bookings}
            WHERE ${bookings.resourceId} = ${id}
              AND ${bookings.status} = 'confirmed'
              AND tstzrange(${bookings.startsAt}, ${bookings.endsAt}) && tstzrange(${slot}, ${slot} + ${length})
          )`,
        ),
      )
      .orderBy(slot);
  }
}

function notFound(): never {
  throw new NotFoundException('Resource not found');
}
