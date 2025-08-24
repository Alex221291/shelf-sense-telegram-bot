import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegramBotService } from './telegram-bot.service';
import { ShelfSenseService } from '../services/shelf-sense.service';

@Module({
  imports: [ConfigModule],
  providers: [TelegramBotService, ShelfSenseService],
  exports: [TelegramBotService],
})
export class TelegramModule {}
