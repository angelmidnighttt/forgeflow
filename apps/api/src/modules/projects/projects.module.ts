import { Module } from '@nestjs/common';
import { EnvironmentsController } from './environments.controller.js';
import { EnvironmentsService } from './environments.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

/** Projects and their environments, under /organizations/:orgId/projects. */
@Module({
  controllers: [ProjectsController, EnvironmentsController],
  providers: [ProjectsService, EnvironmentsService],
})
export class ProjectsModule {}
