import { Module } from '@nestjs/common';
import { ResourcePolicy } from './resource.policy.js';
import { ResourcesController } from './resources.controller.js';
import { ResourcesService } from './resources.service.js';

@Module({
  controllers: [ResourcesController],
  providers: [ResourcesService, ResourcePolicy],
})
export class ResourcesModule {}
