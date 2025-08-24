import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Context } from 'telegraf';
import { ShelfSenseService } from '../services/shelf-sense.service';

@Injectable()
export class TelegramBotService implements OnModuleInit {
  private bot: Telegraf<Context>;

  constructor(
    private readonly shelfSenseService: ShelfSenseService,
    private readonly configService: ConfigService
  ) {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN не настроен');
    }
    
    this.bot = new Telegraf(token);
    this.setupCommands();
  }

  onModuleInit() {
    this.bot.launch();
    console.log('🤖 Telegram Bot запущен');
  }

  private setupCommands() {
    // Команда /start
    this.bot.start(async (ctx) => {
      const welcomeMessage = `
🎯 Добро пожаловать в ShelfSense Bot!

Этот бот поможет вам управлять выкладкой товаров и ценниками.

📋 Доступные команды:
/merchgroups - Список мерч-групп
/shelf_summary - Сводка по выкладке
/price_summary - Сводка по ценникам
/voids - Пустоты в группе
/price_errors - Ошибки по ценникам
/generate_pdf - Генерировать PDF с ценниками

Выберите команду для начала работы!
      `;
      
      await ctx.reply(welcomeMessage);
    });

    // Команда /merchgroups
    this.bot.command('merchgroups', async (ctx) => {
      try {
        const groups = await this.shelfSenseService.getMerchGroups();
        
        if (groups.length === 0) {
          await ctx.reply('📭 Мерч-группы не найдены');
          return;
        }

        let message = '🏷️ Список мерч-групп:\n\n';
        groups.forEach((group, index) => {
          message += `${index + 1}. ${group.name} (ID: ${group.id})\n`;
        });

        await ctx.reply(message);
      } catch (error) {
        await ctx.reply('❌ Ошибка при получении мерч-групп');
      }
    });

    // Команда /shelf_summary
    this.bot.command('shelf_summary', async (ctx) => {
      try {
        const summary = await this.shelfSenseService.getShelfSummary();
        
        const message = `
📊 Сводка по выкладке товара:

🪑 Полок с пустотами: ${summary.shelves_with_voids}
📈 Процент пустот: ${summary.voids_percent.toFixed(2)}%
📦 SKU для заполнения: ${summary.skus_to_fill}
🆕 Новых пустот: ${summary.new_voids}

🏆 Топ группы:
${summary.top_groups.map((group, index) => `${index + 1}. ${group}`).join('\n')}
        `;

        await ctx.reply(message);
      } catch (error) {
        await ctx.reply('❌ Ошибка при получении сводки по выкладке');
      }
    });

    // Команда /price_summary
    this.bot.command('price_summary', async (ctx) => {
      try {
        const summary = await this.shelfSenseService.getPriceSummary();
        
        const message = `
🏷️ Сводка по ценникам:

🪑 Полок с ошибками: ${summary.shelves_with_errors}
📈 Процент ошибок: ${summary.errors_percent.toFixed(2)}%
💰 Несоответствие цен: ${summary.price_mismatch}
📋 Несоответствие шаблонов: ${summary.tag_template_mismatch}
❌ Отсутствующие ценники: ${summary.tags_missing}
➕ Лишние ценники: ${summary.tags_extra}

🏆 Топ группы:
${summary.top_groups.map((group, index) => `${index + 1}. ${group}`).join('\n')}
        `;

        await ctx.reply(message);
      } catch (error) {
        await ctx.reply('❌ Ошибка при получении сводки по ценникам');
      }
    });

    // Команда /voids
    this.bot.command('voids', async (ctx) => {
      const message = `
🔍 Для получения списка пустот в группе, используйте команду:
/voids_group [ID_группы]

Например: /voids_group abc123

Сначала получите список групп командой /merchgroups
      `;
      
      await ctx.reply(message);
    });

    // Команда /voids_group
    this.bot.command('voids_group', async (ctx) => {
      const message = ctx.message?.text;
      if (!message) return;

      const groupId = message.split(' ')[1];
      if (!groupId) {
        await ctx.reply('❌ Укажите ID группы. Пример: /voids_group abc123');
        return;
      }

      try {
        const voids = await this.shelfSenseService.getShelvesVoids(groupId);
        
        if (voids.length === 0) {
          await ctx.reply('📭 Пустоты в данной группе не найдены');
          return;
        }

        let responseMessage = `🪑 Пустоты в группе (ID: ${groupId}):\n\n`;
        voids.forEach((voidItem, index) => {
          responseMessage += `${index + 1}. ${voidItem.name}\n`;
          responseMessage += `   📍 Полка: ${voidItem.shelf_index}, Позиция: ${voidItem.position}\n`;
          responseMessage += `   🏷️ SKU: ${voidItem.sku}\n`;
          responseMessage += `   📦 Остаток: ${voidItem.stock}\n\n`;
        });

        await ctx.reply(responseMessage);
      } catch (error) {
        await ctx.reply('❌ Ошибка при получении списка пустот');
      }
    });

    // Команда /price_errors
    this.bot.command('price_errors', async (ctx) => {
      const message = `
🔍 Для получения ошибок по ценникам используйте команды:

1. По типу ошибки:
/price_errors_type [ТИП_ОШИБКИ]

Типы ошибок:
- PRICE_MISMATCH (несоответствие цены)
- TAG_TEMPLATE_MISMATCH (несоответствие шаблона)
- TAG_PRODUCT_MISMATCH (несоответствие товара)
- TAG_MISSING (отсутствующий ценник)
- TAG_EXTRA (лишний ценник)

2. По группе:
/price_errors_group [ID_ГРУППЫ]

Примеры:
/price_errors_type PRICE_MISMATCH
/price_errors_group abc123
      `;
      
      await ctx.reply(message);
    });

    // Команда /price_errors_type
    this.bot.command('price_errors_type', async (ctx) => {
      const message = ctx.message?.text;
      if (!message) return;

      const errorType = message.split(' ')[1];
      if (!errorType) {
        await ctx.reply('❌ Укажите тип ошибки. Пример: /price_errors_type PRICE_MISMATCH');
        return;
      }

      try {
        const errors = await this.shelfSenseService.getPriceErrorsByType(errorType);
        
        if (errors.length === 0) {
          await ctx.reply(`📭 Ошибки типа "${errorType}" не найдены`);
          return;
        }

        let responseMessage = `🏷️ Ошибки по ценникам (тип: ${errorType}):\n\n`;
        errors.forEach((error, index) => {
          responseMessage += `${index + 1}. ${error.name || 'Без названия'}\n`;
          responseMessage += `   📍 Полка: ${error.shelf_index}, Позиция: ${error.position}\n`;
          responseMessage += `   🏷️ SKU: ${error.sku || 'Не указан'}\n`;
          responseMessage += `   📋 Группа: ${error.merch_group.name}\n`;
          if (error.details) {
            responseMessage += `   📝 Детали: ${error.details}\n`;
          }
          responseMessage += '\n';
        });

        await ctx.reply(responseMessage);
      } catch (error) {
        await ctx.reply('❌ Ошибка при получении списка ошибок по ценникам');
      }
    });

    // Команда /price_errors_group
    this.bot.command('price_errors_group', async (ctx) => {
      const message = ctx.message?.text;
      if (!message) return;

      const groupId = message.split(' ')[1];
      if (!groupId) {
        await ctx.reply('❌ Укажите ID группы. Пример: /price_errors_group abc123');
        return;
      }

      try {
        const errors = await this.shelfSenseService.getPriceErrorsByGroup(groupId);
        
        if (errors.length === 0) {
          await ctx.reply(`📭 Ошибки по ценникам в группе (ID: ${groupId}) не найдены`);
          return;
        }

        let responseMessage = `🏷️ Ошибки по ценникам в группе (ID: ${groupId}):\n\n`;
        errors.forEach((error, index) => {
          responseMessage += `${index + 1}. ${error.name || 'Без названия'}\n`;
          responseMessage += `   📍 Полка: ${error.shelf_index}, Позиция: ${error.position}\n`;
          responseMessage += `   🏷️ SKU: ${error.sku || 'Не указан'}\n`;
          responseMessage += `   ❌ Тип ошибки: ${error.error_type}\n`;
          if (error.details) {
            responseMessage += `   📝 Детали: ${error.details}\n`;
          }
          responseMessage += '\n';
        });

        await ctx.reply(responseMessage);
      } catch (error) {
        await ctx.reply('❌ Ошибка при получении списка ошибок по ценникам в группе');
      }
    });

    // Команда /generate_pdf
    this.bot.command('generate_pdf', async (ctx) => {
      try {
        await this.shelfSenseService.generateLabelsPdf();
        await ctx.reply('✅ PDF с ценниками успешно сгенерирован!');
      } catch (error) {
        await ctx.reply('❌ Ошибка при генерации PDF с ценниками');
      }
    });

    // Команда /help
    this.bot.command('help', async (ctx) => {
      const helpMessage = `
📚 Справка по командам ShelfSense Bot:

🏷️ Основные команды:
/start - Начать работу с ботом
/help - Показать эту справку

📊 Сводки:
/merchgroups - Список мерч-групп
/shelf_summary - Сводка по выкладке товара
/price_summary - Сводка по ценникам

🔍 Детальная информация:
/voids - Инструкция по получению пустот
/voids_group [ID] - Пустоты в конкретной группе
/price_errors - Инструкция по получению ошибок
/price_errors_type [ТИП] - Ошибки по типу
/price_errors_group [ID] - Ошибки в группе

🖨️ Действия:
/generate_pdf - Сгенерировать PDF с ценниками

💡 Для получения ID групп используйте команду /merchgroups
      `;
      
      await ctx.reply(helpMessage);
    });

    // Обработка текстовых сообщений
    this.bot.on('text', async (ctx) => {
      const text = ctx.message?.text;
      if (!text) return;

      // Если сообщение не является командой, предлагаем помощь
      if (!text.startsWith('/')) {
        await ctx.reply(
          '💡 Используйте команды для работы с ботом. Введите /help для получения справки.'
        );
      }
    });

    // Обработка ошибок
    this.bot.catch((err, ctx) => {
      console.error(`Ошибка в боте:`, err);
      ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
    });
  }
}
