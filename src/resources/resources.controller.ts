import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { ApiSecurity } from '@nestjs/swagger';
import { z } from 'zod';
import { ResourcePolicy } from './resource.policy.js';
import {
  availabilityQuerySchema,
  createResourceSchema,
  updateResourceSchema,
  type AvailabilityQuery,
  type CreateResourceDto,
  type UpdateResourceDto,
} from './resources.schemas.js';
import { ResourcesService } from './resources.service.js';

const resourceId = { schema: z.uuid() };

@Controller('resources')
export class ResourcesController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @Public()
  @ApiSecurity({})
  @Get()
  findAll() {
    return this.resourcesService.findAll();
  }

  @Public()
  @ApiSecurity({})
  @Get(':id')
  findOne(@Param('id', resourceId) id: string) {
    return this.resourcesService.findOne(id);
  }

  @Public()
  @ApiSecurity({})
  @Get(':id/availability')
  async availability(
    @Param('id', resourceId) id: string,
    @Query({ schema: availabilityQuerySchema }) { date }: AvailabilityQuery,
  ) {
    return { date, slots: await this.resourcesService.availability(id, date) };
  }

  @Can(ResourcePolicy, 'manage')
  @Post()
  create(@Body({ schema: createResourceSchema }) dto: CreateResourceDto) {
    return this.resourcesService.create(dto);
  }

  @Can(ResourcePolicy, 'manage')
  @Patch(':id')
  update(@Param('id', resourceId) id: string, @Body({ schema: updateResourceSchema }) dto: UpdateResourceDto) {
    return this.resourcesService.update(id, dto);
  }
}
