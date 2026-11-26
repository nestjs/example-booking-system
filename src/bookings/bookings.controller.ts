import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { z } from 'zod';
import { createBookingSchema, type CreateBookingDto } from './bookings.schemas.js';
import { BookingsService } from './bookings.service.js';

const bookingId = { schema: z.uuid() };

// Any signed-in user books, and sees only their own bookings.
@Can.Anyone()
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  create(@CurrentUser('id') userId: string, @Body({ schema: createBookingSchema }) dto: CreateBookingDto) {
    return this.bookingsService.create(userId, dto);
  }

  @Get()
  findUpcoming(@CurrentUser('id') userId: string) {
    return this.bookingsService.findUpcoming(userId);
  }

  @Get(':id')
  findOne(@CurrentUser('id') userId: string, @Param('id', bookingId) id: string) {
    return this.bookingsService.findOne(userId, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser('id') userId: string, @Param('id', bookingId) id: string) {
    return this.bookingsService.cancel(userId, id);
  }
}
