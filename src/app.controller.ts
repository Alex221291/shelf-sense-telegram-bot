import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getHello(): string {
    return 'ShelfSense Bot API работает! 🚀';
  }

  @Get('health')
  getHealth(): { status: string; timestamp: string } {
    return {
      status: 'OK',
      timestamp: new Date().toISOString()
    };
  }

  @Get('info')
  getInfo(): { 
    name: string; 
    version: string; 
    description: string;
    features: string[];
  } {
    return {
      name: 'ShelfSense Bot API',
      version: '1.0.0',
      description: 'API для Telegram бота управления выкладкой товаров и ценниками',
      features: [
        'Управление выкладкой товаров',
        'Обработка ошибок ценников',
        'Статистика по магазину',
        'Генерация PDF документов',
        'Telegram Bot интеграция'
      ]
    };
  }
}
