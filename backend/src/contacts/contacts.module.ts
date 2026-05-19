import { Module } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { ContactsController } from './contacts.controller';
import { PrismaService } from '../prisma.service';
import { EvolutionModule } from '../evolution/evolution.module';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [EvolutionModule, WebsocketModule],
  controllers: [ContactsController],
  providers: [ContactsService, PrismaService],
  exports: [ContactsService],
})
export class ContactsModule {}
