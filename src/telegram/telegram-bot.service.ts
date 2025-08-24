import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Context } from 'telegraf';
import { ReplyKeyboardMarkup, InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { ShelfSenseService } from '../services/shelf-sense.service';

@Injectable()
export class TelegramBotService implements OnModuleInit {
  private bot: Telegraf<Context>;
  private userStates: Map<number, string> = new Map(); // Простая система состояний пользователей
  private userHistory: Map<number, string[]> = new Map(); // История навигации пользователей

  // Переводы типов ошибок для пользователей
  private getErrorTypeDisplayName(errorType: string): string {
    const errorTypeTranslations: Record<string, string> = {
      'PRICE_MISMATCH': '💰 Некорректная цена',
      'TAG_TEMPLATE_MISMATCH': '🏷️ Некорректный макет',
      'TAG_PRODUCT_MISMATCH': '🔄 Несоответствие товара',
      'TAG_MISSING': '❌ Отсутствует ценник',
      'TAG_EXTRA': '➕ Лишний ценник'
    };
    return errorTypeTranslations[errorType] || errorType;
  }

  // Преобразование русского названия обратно в код API
  private getErrorTypeCode(displayName: string): string {
    const displayNameToCode: Record<string, string> = {
      '💰 Некорректная цена': 'PRICE_MISMATCH',
      '🏷️ Некорректный макет': 'TAG_TEMPLATE_MISMATCH',
      '🔄 Несоответствие товара': 'TAG_PRODUCT_MISMATCH',
      '❌ Отсутствует ценник': 'TAG_MISSING',
      '➕ Лишний ценник': 'TAG_EXTRA'
    };
    return displayNameToCode[displayName] || displayName;
  }

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
      const chatId = ctx.chat?.id;
      if (chatId) {
        console.log(`[${chatId}] Новый пользователь запустил бота`);
        this.addToHistory(chatId, 'main');
      }

      const welcomeMessage = `
🎯 Добро пожаловать в ShelfSense Bot!

Этот бот поможет вам управлять выкладкой товаров и ценниками.

Выберите нужную опцию из меню ниже:
      `;
      
      const keyboard: ReplyKeyboardMarkup = {
        keyboard: [
          ['🏷️ Выкладка товара'],
          ['🏷️ Ценники'],
          ['📚 Помощь'],
          ['🔄 Обновить меню']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      };

      await ctx.reply(welcomeMessage, { reply_markup: keyboard });
    });

    // Обработка текстовых сообщений
    this.bot.on('text', async (ctx) => {
      const text = ctx.message?.text;
      if (!text) return;

      switch (text) {
        case '🏷️ Выкладка товара':
          await this.onShelfManagement(ctx);
          break;
        case '🏷️ Ценники':
          await this.onPriceTags(ctx);
          break;
        case '📚 Помощь':
          await this.onHelp(ctx);
          break;
        case '🔄 Обновить меню':
          await this.onRefreshMenu(ctx);
          break;
        case '🏠 На главную':
          await this.onBackToMain(ctx);
          break;
        case '🔙 Назад':
          await this.onBack(ctx);
          break;
        case '📊 Статистика':
          // Определяем контекст по состоянию пользователя
          const currentChatId = ctx.chat?.id;
          const currentUserState = currentChatId ? this.userStates.get(currentChatId) : null;
          
          if (currentUserState === 'price_tags') {
            await this.onPriceSummary(ctx);
          } else {
            await this.onShelfSummary(ctx);
          }
          break;
        case '🔍 Выбрать группу':
          // Определяем контекст для выбора группы
          const groupChatId = ctx.chat?.id;
          const groupUserState = groupChatId ? this.userStates.get(groupChatId) : null;
          
          if (groupUserState === 'price_tags') {
            // Если мы в меню ценников, устанавливаем специальное состояние
            if (groupChatId) {
              this.userStates.set(groupChatId, 'selecting_price_group');
            }
            await this.onSelectGroup(ctx);
          } else {
            // Если мы в меню выкладки товара
            await this.onSelectGroup(ctx);
          }
          break;
        case '🖨️ Распечатать ценники':
          await this.onGeneratePdf(ctx);
          break;
        case '❌ Выбрать тип ошибки':
          await this.onSelectErrorType(ctx);
          break;
        case '✅ Выполнено':
          await this.onTaskCompleted(ctx);
          break;
        case '❌ Отмена':
          await this.onTaskCancelled(ctx);
          break;
        default:
          // Проверяем состояние пользователя для обработки выбора групп/ошибок
          const chatId = ctx.chat?.id;
          const userState = chatId ? this.userStates.get(chatId) : null;
          
          if (userState === 'selecting_group') {
            await this.handleGroupSelection(ctx, text);
          } else if (userState === 'selecting_price_group') {
            await this.handlePriceGroupSelection(ctx, text);
          } else if (userState === 'selecting_error_type') {
            await this.handleErrorTypeSelection(ctx, text);
          } else if (text.startsWith('/')) {
            // Оставляем поддержку команд для совместимости
            await this.handleCommands(ctx, text);
          } else {
            await ctx.reply('💡 Используйте кнопки меню для навигации');
          }
          break;
      }
    });

    // Обработка callback_query для inline кнопок (если понадобятся)
    this.bot.action('back_to_main', async (ctx) => {
      await this.onBackToMain(ctx);
    });

    // Обработка ошибок
    this.bot.catch((err, ctx) => {
      console.error(`Ошибка в боте:`, err);
      ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
    });
  }

  // Главное меню выкладки товара
  private async onShelfManagement(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (chatId) {
      this.userStates.set(chatId, 'shelf_management');
      console.log(`[${chatId}] Пользователь перешел в меню выкладки товара`);
    }
    
    await this.showShelfManagementMenu(ctx, true);
  }

  // Показать меню выкладки товара (с опцией добавления в историю)
  private async showShelfManagementMenu(ctx: Context, addToHistory: boolean = true) {
    const chatId = ctx.chat?.id;
    if (chatId && addToHistory) {
      this.userStates.set(chatId, 'shelf_management');
      this.addToHistory(chatId, 'shelf_management');
      console.log(`[${chatId}] Пользователь перешел в меню выкладки товара`);
    } else if (chatId) {
      this.userStates.set(chatId, 'shelf_management');
      console.log(`[${chatId}] Возврат в меню выкладки товара`);
    }
    
    const keyboard: ReplyKeyboardMarkup = {
      keyboard: [
        ['📊 Статистика'],
        ['🔍 Выбрать группу'],
        ['🔙 Назад', '🏠 На главную']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    };

    await ctx.reply('🏷️ Выкладка товара\n\nВыберите действие:', { reply_markup: keyboard });
  }

  // Главное меню ценников
  private async onPriceTags(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (chatId) {
      this.userStates.set(chatId, 'price_tags');
      console.log(`[${chatId}] Пользователь перешел в меню ценников`);
    }
    
    await this.showPriceTagsMenu(ctx, true);
  }

  // Показать меню ценников (с опцией добавления в историю)
  private async showPriceTagsMenu(ctx: Context, addToHistory: boolean = true) {
    const chatId = ctx.chat?.id;
    if (chatId && addToHistory) {
      this.userStates.set(chatId, 'price_tags');
      this.addToHistory(chatId, 'price_tags');
      console.log(`[${chatId}] Пользователь перешел в меню ценников`);
    } else if (chatId) {
      this.userStates.set(chatId, 'price_tags');
      console.log(`[${chatId}] Возврат в меню ценников`);
    }
    
    const keyboard: ReplyKeyboardMarkup = {
      keyboard: [
        ['📊 Статистика'],
        ['🖨️ Распечатать ценники'],
        ['❌ Выбрать тип ошибки'],
        ['🔍 Выбрать группу'],
        ['🔙 Назад', '🏠 На главную']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    };

    await ctx.reply('🏷️ Ценники\n\nВыберите действие:', { reply_markup: keyboard });
  }

  // Статистика по выкладке
  private async onShelfSummary(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (chatId) {
      this.addToHistory(chatId, 'shelf_summary');
      console.log(`[${chatId}] Пользователь просматривает статистику по выкладке`);
    }

    try {
      const summary = await this.shelfSenseService.getShelfSummary();
      
      const message = `
📊 Статистика по магазину:

🪑 Стеллажей с пустотами: ${summary.shelves_with_voids} (${summary.voids_percent.toFixed(1)}%)
📦 Артикулов к выкладке: ${summary.skus_to_fill}
🆕 Новых пустот: ${summary.new_voids}

🏆 TOP-5 товарных групп к выкладке:
${summary.top_groups.map((group, index) => `${index + 1}. ${group}`).join('\n')}
      `;

      const keyboard: ReplyKeyboardMarkup = {
        keyboard: [
          ['🔍 Выбрать группу'],
          ['🔙 Назад', '🏠 На главную']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      };

      await ctx.reply(message, { reply_markup: keyboard });
    } catch (error) {
      await ctx.reply('❌ Ошибка при получении статистики по выкладке');
    }
  }

  // Статистика по ценникам
  private async onPriceSummary(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (chatId) {
      this.addToHistory(chatId, 'price_summary');
      console.log(`[${chatId}] Пользователь просматривает статистику по ценникам`);
    }

    try {
      const summary = await this.shelfSenseService.getPriceSummary();
      
      const message = `
📊 Статистика по магазину:

🪑 Стеллажей с ошибками: ${summary.shelves_with_errors} (${summary.errors_percent.toFixed(1)}%)
💰 Некорректная цена: ${summary.price_mismatch}
📋 Некорректный макет: ${summary.tag_template_mismatch}
❌ Отсутствует: ${summary.tags_missing}
➕ Лишний: ${summary.tags_extra}

🏆 TOP-5 товарных групп к исправлению:
${summary.top_groups.map((group, index) => `${index + 1}. ${group}`).join('\n')}
      `;

      const keyboard: ReplyKeyboardMarkup = {
        keyboard: [
          ['🖨️ Распечатать ценники'],
          ['❌ Выбрать тип ошибки'],
          ['🔍 Выбрать группу'],
          ['🔙 Назад', '🏠 На главную']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      };

      await ctx.reply(message, { reply_markup: keyboard });
    } catch (error) {
      await ctx.reply('❌ Ошибка при получении статистики по ценникам');
    }
  }

  // Выбор мерч-группы
  private async onSelectGroup(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (chatId) {
      this.addToHistory(chatId, 'select_group');
      console.log(`[${chatId}] Пользователь выбирает мерч-группу`);
    }

    try {
      const groups = await this.shelfSenseService.getMerchGroups();
      
      if (groups.length === 0) {
        await ctx.reply('📭 Мерч-группы не найдены');
        return;
      }

      // Создаем кнопки с информацией о пустотах прямо в названии
      const groupButtons = [];
      
      for (const group of groups.slice(0, 8)) {
        try {
          const voids = await this.shelfSenseService.getShelvesVoids(group.id);
          const voidCount = voids.length;
          
          // Формируем название кнопки с информацией
          let buttonText = `${group.name}`;
          if (voidCount > 0) {
            // Получаем уникальные номера полок
            const shelfNumbers = [...new Set(voids.map(v => v.shelf_index))].sort((a, b) => a - b);
            const shelfList = shelfNumbers.join(',');
            buttonText += ` (пустот: ${voidCount}, полки: ${shelfList})`;
          } else {
            buttonText += ` (пустот: 0)`;
          }
          
          groupButtons.push([buttonText]);
        } catch (error) {
          // Если не удалось получить данные, показываем группу без информации
          groupButtons.push([`${group.name} (?)`]);
        }
      }
      
      const keyboard: ReplyKeyboardMarkup = {
        keyboard: [
          ...groupButtons,
          ['🔙 Назад', '🏠 На главную']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      };

      await ctx.reply('🏷️ Выберите мерч-группу:', { reply_markup: keyboard });
      
      // Сохраняем группы в состоянии для обработки выбора
      if (chatId) {
        this.userStates.set(chatId, 'selecting_group');
        // Временно сохраняем группы для этого пользователя
        (this as any).userGroups = (this as any).userGroups || new Map();
        (this as any).userGroups.set(chatId, groups);
      }
    } catch (error) {
      await ctx.reply('❌ Ошибка при получении списка мерч-групп');
    }
  }

  // Выбор типа ошибки
  private async onSelectErrorType(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (chatId) {
      this.addToHistory(chatId, 'select_error_type');
      this.userStates.set(chatId, 'selecting_error_type');
      console.log(`[${chatId}] Пользователь выбирает тип ошибки`);
    }

          const keyboard: ReplyKeyboardMarkup = {
        keyboard: [
          ['💰 Некорректная цена'],
          ['🏷️ Некорректный макет'],
          ['🔄 Несоответствие товара'],
          ['❌ Отсутствует ценник'],
          ['➕ Лишний ценник'],
          ['🔙 Назад', '🏠 На главную']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      };

    await ctx.reply('❌ Выберите тип ошибки:', { reply_markup: keyboard });
  }

  // Генерация PDF
  private async onGeneratePdf(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (chatId) {
      console.log(`[${chatId}] Пользователь генерирует PDF ценников`);
    }

    try {
      console.log(`[${chatId}] Запрос к сервису для генерации PDF...`);
      const pdfResult = await this.shelfSenseService.generateLabelsPdf();
      console.log(`[${chatId}] Результат генерации PDF:`, JSON.stringify(pdfResult, null, 2));
      
      const message = `✅ PDF-документ для нарезки и замены ценников успешно сгенерирован!

📄 **Файл:** Ценники для печати.pdf
🔗 **Ссылка:** ${pdfResult.file_url}

💡 Используйте ссылку для скачивания файла`;
      
      const keyboard: ReplyKeyboardMarkup = {
        keyboard: [
          ['🔙 Назад', '🏠 На главную']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      };

      await ctx.reply(message, { reply_markup: keyboard });
    } catch (error) {
      console.error(`[${chatId}] Ошибка при генерации PDF:`, error);
      await ctx.reply('❌ Ошибка при генерации PDF-документа');
    }
  }

  // Задача выполнена
  private async onTaskCompleted(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (chatId) {
      console.log(`[${chatId}] Пользователь отметил задачу как выполненную`);
    }

    const message = '✅ Задача отмечена как выполненная!';
    
    const keyboard: ReplyKeyboardMarkup = {
      keyboard: [
        ['🔙 Назад', '🏠 На главную']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    };

    await ctx.reply(message, { reply_markup: keyboard });
  }

  // Задача отменена
  private async onTaskCancelled(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (chatId) {
      console.log(`[${chatId}] Пользователь отменил задачу`);
    }

    const message = '❌ Задача отменена. Укажите причину в следующем сообщении.';
    
    const keyboard: ReplyKeyboardMarkup = {
      keyboard: [
        ['🔙 Назад', '🏠 На главную']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    };

    await ctx.reply(message, { reply_markup: keyboard });
  }

  // Обновление меню
  private async onRefreshMenu(ctx: Context) {
    // Сбрасываем состояние пользователя и историю
    const chatId = ctx.chat?.id;
    if (chatId) {
      console.log(`[${chatId}] Обновление меню`);
      this.userStates.delete(chatId);
      this.userHistory.delete(chatId);
      // Добавляем главную страницу в историю
      this.addToHistory(chatId, 'main');
    }
    
    const welcomeMessage = `
🔄 Меню обновлено!

🎯 Главное меню ShelfSense Bot

Выберите нужную опцию:
    `;
    
    const keyboard: ReplyKeyboardMarkup = {
      keyboard: [
        ['🏷️ Выкладка товара'],
        ['🏷️ Ценники'],
        ['📚 Помощь'],
        ['🔄 Обновить меню']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    };

    await ctx.reply(welcomeMessage, { reply_markup: keyboard });
  }

  // Возврат в главное меню
  private async onBackToMain(ctx: Context) {
    // Сбрасываем состояние пользователя и историю
    const chatId = ctx.chat?.id;
    if (chatId) {
      console.log(`[${chatId}] Возврат в главное меню`);
      this.userStates.delete(chatId);
      this.userHistory.delete(chatId);
      // Добавляем главную страницу в историю
      this.addToHistory(chatId, 'main');
    }
    
    const welcomeMessage = `
🎯 Главное меню ShelfSense Bot

Выберите нужную опцию:
    `;
    
    const keyboard: ReplyKeyboardMarkup = {
      keyboard: [
        ['🏷️ Выкладка товара'],
        ['🏷️ Ценники'],
        ['📚 Помощь'],
        ['🔄 Обновить меню']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    };

    await ctx.reply(welcomeMessage, { reply_markup: keyboard });
  }

  // Справка
  private async onHelp(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (chatId) {
      console.log(`[${chatId}] Пользователь открыл справку`);
    }

    const helpMessage = `
📚 **Справка по ShelfSense Bot**

🤖 **Что умеет бот:**
Этот бот помогает сотрудникам магазина управлять выкладкой товаров и исправлять ошибки ценников через удобное меню.

📊 **Выкладка товара:**
• **Статистика** - показывает общую статистику по магазину:
  - Количество стеллажей с пустотами
  - Количество артикулов к выкладке
  - TOP-5 товарных групп к выкладке
• **Выбрать группу** - позволяет выбрать мерч-группу и увидеть:
  - Список пустот с указанием полки и позиции
  - Информацию о товарах (артикул, название, остатки)
  - Возможность отметить выполнение или отмену

🏷️ **Ценники:**
• **Статистика** - показывает статистику по ошибкам ценников:
  - Количество стеллажей с ошибками
  - Распределение по типам ошибок
  - TOP-5 товарных групп к исправлению
• **Распечатать ценники** - генерирует PDF-документ для печати
• **Выбрать тип ошибки** - фильтрует ошибки по типам:
  - 💰 Некорректная цена
  - 🏷️ Некорректный макет
  - 🔄 Несоответствие товара
  - ❌ Отсутствует ценник
  - ➕ Лишний ценник
• **Выбрать группу** - показывает ошибки в конкретной группе

🎯 **Навигация:**
• **🔙 Назад** - возврат на предыдущую страницу
• **🏠 На главную** - возврат в главное меню
• **🔄 Обновить меню** - обновление данных с сервера

💡 **Советы:**
• Используйте кнопки меню для навигации
• В каждом разделе есть кнопки "Назад" и "На главную"
• Данные обновляются в реальном времени
• Для получения справки нажмите "❓ Помощь" в любом меню
    `;

    const keyboard: ReplyKeyboardMarkup = {
      keyboard: [
        ['🔙 Назад', '🏠 На главную']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    };

    await ctx.reply(helpMessage, { reply_markup: keyboard });
  }

  // Обработка текстовых команд
  private async handleCommands(ctx: Context, command: string) {
    const parts = command.split(' ');
    const cmd = parts[0];

    switch (cmd) {
      case '/voids_group':
        await this.handleVoidsGroup(ctx, parts);
        break;
      case '/price_errors_type':
        await this.handlePriceErrorsType(ctx, parts);
        break;
      case '/price_errors_group':
        await this.handlePriceErrorsGroup(ctx, parts);
        break;
      case '/help':
        await this.onHelp(ctx);
        break;
      default:
        await ctx.reply('❌ Неизвестная команда. Используйте /help для получения справки.');
        break;
    }
  }

  // Обработка команды /voids_group
  private async handleVoidsGroup(ctx: Context, parts: string[]) {
    if (parts.length < 2) {
      await ctx.reply('❌ Укажите ID группы. Пример: /voids_group abc123');
      return;
    }

    const groupId = parts[1];
    
    try {
      const voids = await this.shelfSenseService.getShelvesVoids(groupId);
      
      if (voids.length === 0) {
        await ctx.reply('📭 Пустоты в данной группе не найдены');
        return;
      }

      let responseMessage = `🪑 Перечень пустот в группе (ID: ${groupId}):\n\n`;
      voids.forEach((voidItem, index) => {
        responseMessage += `${index + 1}. Полка ${voidItem.shelf_index} / Позиция ${voidItem.position}\n`;
        responseMessage += `   [${voidItem.sku}] ${voidItem.name}\n`;
        responseMessage += `   Остатки: ${voidItem.stock}\n\n`;
      });
      responseMessage += '📸 Фото стеллажа будет добавлено в следующих версиях';

      const keyboard: ReplyKeyboardMarkup = {
        keyboard: [
          ['✅ Выполнено'],
          ['❌ Отмена'],
          ['🔙 Назад', '🏠 На главную']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      };

      await ctx.reply(responseMessage, { reply_markup: keyboard });
    } catch (error) {
      await ctx.reply('❌ Ошибка при получении списка пустот');
    }
  }

  // Обработка команды /price_errors_type
  private async handlePriceErrorsType(ctx: Context, parts: string[]) {
    if (parts.length < 2) {
      await ctx.reply('❌ Укажите тип ошибки. Пример: /price_errors_type PRICE_MISMATCH');
      return;
    }

    const errorType = parts[1];
    
    try {
      const errors = await this.shelfSenseService.getPriceErrorsByType(errorType);
      
      if (errors.length === 0) {
        await ctx.reply(`📭 Ошибки типа "${errorType}" не найдены`);
        return;
      }

      let responseMessage = `🏷️ Перечень ошибок по ценникам (тип: ${errorType}):\n\n`;
      errors.forEach((error, index) => {
        responseMessage += `${index + 1}. ${error.merch_group.name}\n`;
        responseMessage += `   Полка ${error.shelf_index} / Позиция ${error.position}\n`;
        responseMessage += `   [${error.sku || 'Не указан'}] ${error.name || 'Без названия'}\n`;
        if (error.details) {
          responseMessage += `   Детали: ${error.details}\n`;
        }
        responseMessage += '\n';
      });
      responseMessage += '📸 Миниатюра с фото стеллажа будет добавлена в следующих версиях';

      const keyboard: ReplyKeyboardMarkup = {
        keyboard: [
          ['✅ Выполнено'],
          ['❌ Отмена'],
          ['🔙 Назад', '🏠 На главную']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      };

      await ctx.reply(responseMessage, { reply_markup: keyboard });
    } catch (error) {
      await ctx.reply('❌ Ошибка при получении списка ошибок по ценникам');
    }
  }

  // Обработка команды /price_errors_group
  private async handlePriceErrorsGroup(ctx: Context, parts: string[]) {
    if (parts.length < 2) {
      await ctx.reply('❌ Укажите ID группы. Пример: /price_errors_group abc123');
      return;
    }

    const groupId = parts[1];
    
    try {
      const errors = await this.shelfSenseService.getPriceErrorsByGroup(groupId);
      
      if (errors.length === 0) {
        await ctx.reply(`📭 Ошибки по ценникам в группе (ID: ${groupId}) не найдены`);
        return;
      }

      let responseMessage = `🏷️ Перечень ошибок по ценникам в группе (ID: ${groupId}):\n\n`;
      errors.forEach((error, index) => {
        responseMessage += `${index + 1}. ${this.getErrorTypeDisplayName(error.error_type)} / Полка ${error.shelf_index} / Позиция ${error.position}\n`;
        responseMessage += `   [${error.sku || 'Не указан'}] ${error.name || 'Без названия'}\n`;
        if (error.details) {
          responseMessage += `   Детали: ${error.details}\n`;
        }
        responseMessage += '\n';
      });
      responseMessage += '📸 Миниатюра с фото стеллажа будет добавлена в следующих версиях';

      const keyboard: ReplyKeyboardMarkup = {
        keyboard: [
          ['✅ Выполнено'],
          ['❌ Отмена'],
          ['🔙 Назад', '🏠 На главную']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      };

      await ctx.reply(responseMessage, { reply_markup: keyboard });
    } catch (error) {
      await ctx.reply('❌ Ошибка при получении списка ошибок по ценникам в группе');
    }
  }

  // Обработка выбора группы
  private async handleGroupSelection(ctx: Context, groupName: string) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    console.log(`[${chatId}] Пользователь выбрал группу: ${groupName}`);

    const userGroups = (this as any).userGroups?.get(chatId);
    if (!userGroups) {
      await ctx.reply('❌ Ошибка: группы не найдены. Попробуйте выбрать группу снова.');
      return;
    }

    // Извлекаем оригинальное название группы из текста кнопки
    // Формат кнопки: "Название группы (пустот: X, полки: Y,Z)" или "Название группы (?)"
    const originalGroupName = groupName.replace(/\s*\(пустот:\s*\d+(?:,\s*полки:\s*[\d,]+)?\)$/, '').replace(/\s*\(\?\)$/, '');
    
    const selectedGroup = userGroups.find((group: any) => group.name === originalGroupName);
    if (!selectedGroup) {
      await ctx.reply('❌ Группа не найдена. Выберите группу из списка.');
      return;
    }

    try {
      // Получаем пустоты для выбранной группы
      const voids = await this.shelfSenseService.getShelvesVoids(selectedGroup.id);
      
      if (voids.length === 0) {
        await ctx.reply('📭 Пустоты в данной группе не найдены');
        return;
      }

      let responseMessage = `🪑 Перечень пустот в группе "${originalGroupName}":\n\n`;
      voids.forEach((voidItem, index) => {
        responseMessage += `${index + 1}. Полка ${voidItem.shelf_index} / Позиция ${voidItem.position}\n`;
        responseMessage += `   [${voidItem.sku}] ${voidItem.name}\n`;
        responseMessage += `   Остатки: ${voidItem.stock}\n\n`;
      });
      responseMessage += '📸 Фото стеллажа будет добавлено в следующих версиях';

      const keyboard: ReplyKeyboardMarkup = {
        keyboard: [
          ['✅ Выполнено'],
          ['❌ Отмена'],
          ['🔙 Назад', '🏠 На главную']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      };

      await ctx.reply(responseMessage, { reply_markup: keyboard });
      
      // Сбрасываем состояние и очищаем группы
      this.userStates.delete(chatId);
      (this as any).userGroups.delete(chatId);
    } catch (error) {
      await ctx.reply('❌ Ошибка при получении списка пустот');
      this.userStates.delete(chatId);
      (this as any).userGroups.delete(chatId);
    }
  }

  // Обработка выбора типа ошибки
  private async handleErrorTypeSelection(ctx: Context, errorType: string) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    console.log(`[${chatId}] Пользователь выбрал тип ошибки: ${errorType}`);

    // Преобразуем русское название в код для API
    const errorTypeCode = this.getErrorTypeCode(errorType);
    
    try {
      const errors = await this.shelfSenseService.getPriceErrorsByType(errorTypeCode);
      
      if (errors.length === 0) {
        await ctx.reply(`📭 Ошибки типа "${errorType}" не найдены`);
        return;
      }

      let responseMessage = `🏷️ Перечень ошибок по ценникам (тип: ${errorType}):\n\n`;
      errors.forEach((error, index) => {
        responseMessage += `${index + 1}. ${error.merch_group.name}\n`;
        responseMessage += `   Полка ${error.shelf_index} / Позиция ${error.position}\n`;
        responseMessage += `   [${error.sku || 'Не указан'}] ${error.name || 'Без названия'}\n`;
        if (error.details) {
          responseMessage += `   Детали: ${error.details}\n`;
        }
        responseMessage += '\n';
      });
      responseMessage += '📸 Миниатюра с фото стеллажа будет добавлена в следующих версиях';

      const keyboard: ReplyKeyboardMarkup = {
        keyboard: [
          ['✅ Выполнено'],
          ['❌ Отмена'],
          ['🔙 Назад', '🏠 На главную']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      };

      await ctx.reply(responseMessage, { reply_markup: keyboard });
      
      // Сбрасываем состояние
      this.userStates.delete(chatId);
    } catch (error) {
      await ctx.reply('❌ Ошибка при получении списка ошибок по ценникам');
      this.userStates.delete(chatId);
    }
  }

  // Обработка выбора группы для ценников
  private async handlePriceGroupSelection(ctx: Context, groupName: string) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    console.log(`[${chatId}] Пользователь выбрал группу для ценников: ${groupName}`);

    const userGroups = (this as any).userGroups?.get(chatId);
    if (!userGroups) {
      await ctx.reply('❌ Ошибка: группы не найдены. Попробуйте выбрать группу снова.');
      return;
    }

    // Извлекаем оригинальное название группы из текста кнопки
    // Формат кнопки: "Название группы (пустот: X, полки: Y,Z)" или "Название группы (?)"
    const originalGroupName = groupName.replace(/\s*\(пустот:\s*\d+(?:,\s*полки:\s*[\d,]+)?\)$/, '').replace(/\s*\(\?\)$/, '');
    
    const selectedGroup = userGroups.find((group: any) => group.name === originalGroupName);
    if (!selectedGroup) {
      await ctx.reply('❌ Группа не найдена. Выберите группу из списка.');
      return;
    }

    try {
      // Получаем ошибки по ценникам для выбранной группы
      const errors = await this.shelfSenseService.getPriceErrorsByGroup(selectedGroup.id);
      
      if (errors.length === 0) {
        await ctx.reply(`📭 Ошибки по ценникам в группе "${groupName}" не найдены`);
        return;
      }

      let responseMessage = `🏷️ Перечень ошибок по ценникам в группе "${originalGroupName}":\n\n`;
      errors.forEach((error, index) => {
        responseMessage += `${index + 1}. ${this.getErrorTypeDisplayName(error.error_type)} / Полка ${error.shelf_index} / Позиция ${error.position}\n`;
        responseMessage += `   [${error.sku || 'Не указан'}] ${error.name || 'Без названия'}\n`;
        if (error.details) {
          responseMessage += `   Детали: ${error.details}\n`;
        }
        responseMessage += '\n';
      });
      responseMessage += '📸 Миниатюра с фото стеллажа будет добавлена в следующих версиях';

      const keyboard: ReplyKeyboardMarkup = {
        keyboard: [
          ['✅ Выполнено'],
          ['❌ Отмена'],
          ['🔙 Назад', '🏠 На главную']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      };

      await ctx.reply(responseMessage, { reply_markup: keyboard });
      
      // Сбрасываем состояние и очищаем группы
      this.userStates.delete(chatId);
      (this as any).userGroups.delete(chatId);
    } catch (error) {
      await ctx.reply('❌ Ошибка при получении списка ошибок по ценникам в группе');
      this.userStates.delete(chatId);
      (this as any).userGroups.delete(chatId);
    }
  }

  // Добавление в историю навигации
  private addToHistory(chatId: number, page: string) {
    if (!this.userHistory.has(chatId)) {
      this.userHistory.set(chatId, []);
    }
    const history = this.userHistory.get(chatId)!;
    history.push(page);
    // Ограничиваем историю последними 10 страницами
    if (history.length > 10) {
      history.shift();
    }
    console.log(`[${chatId}] История навигации: ${history.join(' → ')}`);
  }

  // Получение предыдущей страницы из истории
  private getPreviousPage(chatId: number): string | null {
    const history = this.userHistory.get(chatId);
    if (!history || history.length < 2) {
      return null;
    }
    // Убираем текущую страницу и возвращаем предыдущую
    history.pop();
    return history[history.length - 1] || null;
  }

  // Обработка кнопки "Назад"
  private async onBack(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    console.log(`[${chatId}] Пользователь нажал кнопку "Назад"`);

    const previousPage = this.getPreviousPage(chatId);
    console.log(`[${chatId}] Предыдущая страница: ${previousPage}`);
    
    if (!previousPage) {
      // Если истории нет, возвращаемся на главную
      console.log(`[${chatId}] История пуста, возвращаемся на главную`);
      await this.onBackToMain(ctx);
      return;
    }

    // Возвращаемся на предыдущую страницу
    console.log(`[${chatId}] Возвращаемся на страницу: ${previousPage}`);
    switch (previousPage) {
      case 'main':
        await this.onBackToMain(ctx);
        break;
      case 'shelf_management':
        await this.showShelfManagementMenu(ctx, false); // false = не добавляем в историю
        break;
      case 'price_tags':
        await this.showPriceTagsMenu(ctx, false); // false = не добавляем в историю
        break;
      case 'shelf_summary':
        await this.showShelfManagementMenu(ctx, false); // Возвращаемся в меню выкладки
        break;
      case 'price_summary':
        await this.showPriceTagsMenu(ctx, false); // Возвращаемся в меню ценников
        break;
      case 'select_group':
        // Возвращаемся в предыдущее меню в зависимости от контекста
        const userState = this.userStates.get(chatId);
        if (userState === 'selecting_price_group') {
          await this.showPriceTagsMenu(ctx, false);
        } else {
          await this.showShelfManagementMenu(ctx, false);
        }
        break;
      case 'select_error_type':
        await this.showPriceTagsMenu(ctx, false); // Возвращаемся в меню ценников
        break;
      default:
        console.log(`[${chatId}] Неизвестная страница в истории: ${previousPage}, возвращаемся на главную`);
        await this.onBackToMain(ctx);
        break;
    }
  }
}
