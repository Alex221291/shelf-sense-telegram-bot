import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  const port = process.env.PORT || 5000;
  
  console.log('🚀 ShelfSense Telegram Bot запущен!');
  console.log('📱 Бот готов к работе');
  console.log(`🌐 Приложение запущено на порту ${port}`);
  
  await app.listen(port);
}

bootstrap();
