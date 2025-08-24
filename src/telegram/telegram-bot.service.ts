import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Context } from 'telegraf';
import { ReplyKeyboardMarkup, InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { ShelfSenseService } from '../services/shelf-sense.service';
import { TaskActionTypes } from '../types/shelf-sense.types';

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
            await this.showPriceSummaryInline(ctx);
          } else {
            await this.showShelfSummaryInline(ctx);
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
            await this.onSelectPriceGroup(ctx);
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
        case '💬 Без комментария':
          await this.onNoComment(ctx);
          break;
        default:
          // Проверяем состояние пользователя для обработки выбора групп/ошибок
          const chatId = ctx.chat?.id;
          const userState = chatId ? this.userStates.get(chatId) : null;
          
          console.log(`[${chatId}] Обработка текста "${text}" в состоянии: ${userState}`);
          
          if (userState === 'selecting_group') {
            await this.handleGroupSelection(ctx, text);
          } else if (userState === 'selecting_void') {
            await this.handleVoidSelection(ctx, text);
          } else if (userState === 'selecting_price_group') {
            await this.handlePriceGroupSelection(ctx, text);
          } else if (userState === 'selecting_price_error') {
            await this.handlePriceErrorSelection(ctx, text);
          } else if (userState === 'selecting_error_type') {
            await this.handleErrorTypeSelection(ctx, text);
          } else if (userState === 'selecting_error_by_type') {
            await this.handleErrorByTypeSelection(ctx, text);
          } else if (userState === 'waiting_void_comment' || userState === 'waiting_price_error_comment') {
            // Обработка комментария для выполнения задачи
            await this.handleTaskCompletionComment(ctx, text);
          } else if (userState === 'waiting_void_cancel_comment' || userState === 'waiting_price_error_cancel_comment') {
            // Обработка комментария для отмены задачи
            await this.handleTaskCancellationComment(ctx, text);
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

  // Статистика по выкладке (без перехода в подменю)
  private async showShelfSummaryInline(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (chatId) {
      console.log(`[${chatId}] Пользователь просматривает статистику по выкладке (inline)`);
    }

    try {
      const summary = await this.shelfSenseService.getShelfSummary();
      
      const message = `
📊 **Статистика по магазину:**

🪑 **Стеллажей с пустотами:** ${summary.shelves_with_voids} (${summary.voids_percent.toFixed(1)}%)
📦 **Артикулов к выкладке:** ${summary.skus_to_fill}
🆕 **Новых пустот:** ${summary.new_voids}

🏆 **TOP-5 товарных групп к выкладке:**
${summary.top_groups.map((group, index) => `${index + 1}. ${group}`).join('\n')}
      `;

      await ctx.reply(message, { parse_mode: 'Markdown' });
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

  // Статистика по ценникам (без перехода в подменю)
  private async showPriceSummaryInline(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (chatId) {
      console.log(`[${chatId}] Пользователь просматривает статистику по ценникам (inline)`);
    }

    try {
      const summary = await this.shelfSenseService.getPriceSummary();
      
      const message = `
📊 **Статистика по магазину:**

🪑 **Стеллажей с ошибками:** ${summary.shelves_with_errors} (${summary.errors_percent.toFixed(1)}%)
💰 **Некорректная цена:** ${summary.price_mismatch}
📋 **Некорректный макет:** ${summary.tag_template_mismatch}
❌ **Отсутствует:** ${summary.tags_missing}
➕ **Лишний:** ${summary.tags_extra}

🏆 **TOP-5 товарных групп к исправлению:**
${summary.top_groups.map((group, index) => `${index + 1}. ${group}`).join('\n')}
      `;

      await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
      await ctx.reply('❌ Ошибка при получении статистики по ценникам');
    }
  }

  // Выбор мерч-группы для ценников
  private async onSelectPriceGroup(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (chatId) {
      this.addToHistory(chatId, 'select_price_group');
      console.log(`[${chatId}] Пользователь выбирает мерч-группу для ценников`);
    }

    try {
      const groups = await this.shelfSenseService.getMerchGroups();
      
      if (groups.length === 0) {
        await ctx.reply('📭 Мерч-группы не найдены');
        return;
      }

      // Создаем кнопки с информацией об ошибках ценников прямо в названии
      const groupButtons = [];
      
      for (const group of groups.slice(0, 8)) {
        try {
          const errors = await this.shelfSenseService.getPriceErrorsByGroup(group.id);
          const errorCount = errors.length;
          
          // Формируем название кнопки с информацией
          let buttonText = `${group.name}`;
          if (errorCount > 0) {
            // Получаем уникальные типы ошибок
            const errorTypes = [...new Set(errors.map(e => e.error_type))];
            const errorTypesList = errorTypes.map(type => this.getErrorTypeDisplayName(type)).join(', ');
            buttonText += ` (ошибок: ${errorCount}, типы: ${errorTypesList})`;
          } else {
            buttonText += ` (ошибок: 0)`;
          }
          
          groupButtons.push([buttonText]);
        } catch (error) {
          console.error(`[${chatId}] Ошибка получения ошибок ценников для группы ${group.name}:`, error);
          groupButtons.push([`${group.name} (?)`]); // Fallback button text
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

      await ctx.reply('🏷️ Выберите мерч-группу для просмотра ошибок ценников:', { reply_markup: keyboard });
      
      // Сохраняем группы в состоянии для обработки выбора
      if (chatId) {
        this.userStates.set(chatId, 'selecting_price_group');
        // Временно сохраняем группы для этого пользователя
        (this as any).userGroups = (this as any).userGroups || new Map();
        (this as any).userGroups.set(chatId, groups);
      }
    } catch (error) {
      await ctx.reply('❌ Ошибка при получении списка мерч-групп');
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
    if (!chatId) return;

    console.log(`[${chatId}] Пользователь отметил задачу как выполненную`);

    try {
      // Определяем тип задачи по состоянию пользователя
      const userState = this.userStates.get(chatId);
      
      if (userState === 'void_action') {
        // Обработка пустоты в выкладке
        const selectedVoid = (this as any).selectedVoid?.get(chatId);
        if (selectedVoid) {
          // Переводим в состояние ожидания комментария
          this.userStates.set(chatId, 'waiting_void_comment');
          
          const message = `✅ **Подтверждение выполнения задачи**

📍 **Расположение:** Полка ${selectedVoid.void.shelf_index} / Позиция ${selectedVoid.void.position}
🏷️ **Группа:** ${selectedVoid.group.name}
📦 **Товар:** [${selectedVoid.void.sku}] ${selectedVoid.void.name}

💬 **Введите комментарий к выполнению задачи** (или нажмите "Без комментария"):`;

          const keyboard: ReplyKeyboardMarkup = {
            keyboard: [
              ['💬 Без комментария'],
              ['🔙 Назад', '🏠 На главную']
            ],
            resize_keyboard: true,
            one_time_keyboard: false
          };

          await ctx.reply(message, { reply_markup: keyboard, parse_mode: 'Markdown' });
        }
      } else if (userState === 'price_error_action') {
        // Обработка ошибки ценника
        const selectedPriceError = (this as any).selectedPriceError?.get(chatId);
        if (selectedPriceError) {
          // Переводим в состояние ожидания комментария
          this.userStates.set(chatId, 'waiting_price_error_comment');
          
          const message = `✅ **Подтверждение исправления ошибки ценника**

📍 **Расположение:** Полка ${selectedPriceError.error.shelf_index} / Позиция ${selectedPriceError.error.position}
🏷️ **Группа:** ${selectedPriceError.group.name}
❌ **Тип ошибки:** ${this.getErrorTypeDisplayName(selectedPriceError.error.error_type)}
📦 **Товар:** [${selectedPriceError.error.sku || 'Не указан'}] ${selectedPriceError.error.name || 'Без названия'}

💬 **Введите комментарий к исправлению** (или нажмите "Без комментария"):`;

          const keyboard: ReplyKeyboardMarkup = {
            keyboard: [
              ['💬 Без комментария'],
              ['🔙 Назад', '🏠 На главную']
            ],
            resize_keyboard: true,
            one_time_keyboard: false
          };

          await ctx.reply(message, { reply_markup: keyboard, parse_mode: 'Markdown' });
        }
      } else {
        // Общий случай
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
    } catch (error) {
      console.error(`[${chatId}] Ошибка при отметке задачи как выполненной:`, error);
      await ctx.reply('❌ Ошибка при отметке задачи. Попробуйте позже.');
    }
  }

  // Задача отменена
  private async onTaskCancelled(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    console.log(`[${chatId}] Пользователь отменил задачу`);

    try {
      // Определяем тип задачи по состоянию пользователя
      const userState = this.userStates.get(chatId);
      
      if (userState === 'void_action') {
        // Обработка отмены пустоты в выкладке
        const selectedVoid = (this as any).selectedVoid?.get(chatId);
        if (selectedVoid) {
          // Переводим в состояние ожидания комментария для отмены
          this.userStates.set(chatId, 'waiting_void_cancel_comment');
          
          const message = `❌ **Отмена задачи**

📍 **Расположение:** Полка ${selectedVoid.void.shelf_index} / Позиция ${selectedVoid.void.position}
🏷️ **Группа:** ${selectedVoid.group.name}
📦 **Товар:** [${selectedVoid.void.sku}] ${selectedVoid.void.name}

💬 **Введите причину отмены задачи** (или нажмите "Без комментария"):`;

          const keyboard: ReplyKeyboardMarkup = {
            keyboard: [
              ['💬 Без комментария'],
              ['🔙 Назад', '🏠 На главную']
            ],
            resize_keyboard: true,
            one_time_keyboard: false
          };

          await ctx.reply(message, { reply_markup: keyboard, parse_mode: 'Markdown' });
        }
      } else if (userState === 'price_error_action') {
        // Обработка отмены ошибки ценника
        const selectedPriceError = (this as any).selectedPriceError?.get(chatId);
        if (selectedPriceError) {
          // Переводим в состояние ожидания комментария для отмены
          this.userStates.set(chatId, 'waiting_price_error_cancel_comment');
          
          const message = `❌ **Отмена исправления ошибки ценника**

📍 **Расположение:** Полка ${selectedPriceError.error.shelf_index} / Позиция ${selectedPriceError.error.position}
🏷️ **Группа:** ${selectedPriceError.group.name}
❌ **Тип ошибки:** ${this.getErrorTypeDisplayName(selectedPriceError.error.error_type)}
📦 **Товар:** [${selectedPriceError.error.sku || 'Не указан'}] ${selectedPriceError.error.name || 'Без названия'}

💬 **Введите причину отмены** (или нажмите "Без комментария"):`;

          const keyboard: ReplyKeyboardMarkup = {
            keyboard: [
              ['💬 Без комментария'],
              ['🔙 Назад', '🏠 На главную']
            ],
            resize_keyboard: true,
            one_time_keyboard: false
          };

          await ctx.reply(message, { reply_markup: keyboard, parse_mode: 'Markdown' });
        }
      } else {
        // Общий случай
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
    } catch (error) {
      console.error(`[${chatId}] Ошибка при отмене задачи:`, error);
      await ctx.reply('❌ Ошибка при отмене задачи. Попробуйте позже.');
    }
  }

  // Обработка кнопки "Без комментария"
  private async onNoComment(ctx: Context) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    console.log(`[${chatId}] Пользователь выбрал "Без комментария"`);

    const userState = this.userStates.get(chatId);
    
    if (userState === 'waiting_void_comment') {
      // Выполняем задачу без комментария
      await this.handleTaskCompletionComment(ctx, '💬 Без комментария');
    } else if (userState === 'waiting_price_error_comment') {
      // Исправляем ошибку ценника без комментария
      await this.handleTaskCompletionComment(ctx, '💬 Без комментария');
    } else if (userState === 'waiting_void_cancel_comment') {
      // Отменяем задачу без комментария
      await this.handleTaskCancellationComment(ctx, '💬 Без комментария');
    } else if (userState === 'waiting_price_error_cancel_comment') {
      // Отменяем исправление ошибки ценника без комментария
      await this.handleTaskCancellationComment(ctx, '💬 Без комментария');
    } else {
      await ctx.reply('❌ Неожиданное состояние для обработки "Без комментария"');
    }
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
• **Статистика** - показывает общую статистику по магазину прямо в меню:
  - Количество стеллажей с пустотами
  - Количество артикулов к выкладке
  - TOP-5 товарных групп к выкладке
• **Выбрать группу** - позволяет выбрать мерч-группу и увидеть:
  - Список пустот с указанием полки и позиции
  - Информацию о товарах (артикул, название, остатки)
  - Фото стеллажа с визуальным обозначением
  - Возможность отметить выполнение или отмену

🏷️ **Ценники:**
• **Статистика** - показывает статистику по ошибкам ценников прямо в меню:
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
• Статистика показывается прямо в текущем меню без перехода
• Данные обновляются в реальном времени
• Для получения справки нажмите "📚 Помощь" в любом меню
• При выполнении задач можно добавить комментарий или выбрать "Без комментария"
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

      // Создаем кнопки с краткой информацией о пустотах
      const voidButtons = [];
      
      for (const voidItem of voids.slice(0, 8)) {
        const buttonText = `Полка ${voidItem.shelf_index} / Позиция ${voidItem.position} - [${voidItem.sku}] ${voidItem.name}`;
        voidButtons.push([buttonText]);
      }

      const keyboard: ReplyKeyboardMarkup = {
        keyboard: [
          ...voidButtons,
          ['🔙 Назад', '🏠 На главную']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      };

      await ctx.reply(`🪑 Выберите пустоту в группе "${originalGroupName}":`, { reply_markup: keyboard });
      
      // Сохраняем пустоты и группу для следующего этапа
      if (chatId) {
        this.userStates.set(chatId, 'selecting_void');
        // Сохраняем пустоты и группу для этого пользователя
        (this as any).userVoids = (this as any).userVoids || new Map();
        (this as any).userVoids.set(chatId, { voids, group: selectedGroup });
      }
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
    console.log(`[${chatId}] Код типа ошибки для API: ${errorTypeCode}`);
    
    try {
      console.log(`[${chatId}] Запрос к API getPriceErrorsByType с кодом: ${errorTypeCode}`);
      const errors = await this.shelfSenseService.getPriceErrorsByType(errorTypeCode);
      console.log(`[${chatId}] Получено ошибок от API: ${errors.length}`);
      
      if (errors.length === 0) {
        console.log(`[${chatId}] Ошибки типа "${errorType}" не найдены`);
        await ctx.reply(`📭 Ошибки типа "${errorType}" не найдены`);
        return;
      }

      // Создаем кнопки с краткой информацией об ошибках
      const errorButtons = [];
      
      for (const error of errors.slice(0, 8)) {
        const buttonText = `Полка ${error.shelf_index} / Позиция ${error.position} - [${error.sku || 'Не указан'}] ${error.name || 'Без названия'}`;
        errorButtons.push([buttonText]);
        console.log(`[${chatId}] Создана кнопка: ${buttonText}`);
      }

      const keyboard: ReplyKeyboardMarkup = {
        keyboard: [
          ...errorButtons,
          ['🔙 Назад', '🏠 На главную']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      };

      console.log(`[${chatId}] Отправляем меню с ${errorButtons.length} кнопками ошибок`);
      await ctx.reply(`🏷️ Выберите ошибку ценника типа "${errorType}":`, { reply_markup: keyboard });
      
      // Сохраняем ошибки и тип ошибки для следующего этапа
      if (chatId) {
        this.userStates.set(chatId, 'selecting_error_by_type');
        console.log(`[${chatId}] Установлено состояние: selecting_error_by_type`);
        // Сохраняем ошибки и тип ошибки для этого пользователя
        (this as any).userErrorsByType = (this as any).userErrorsByType || new Map();
        (this as any).userErrorsByType.set(chatId, { errors, errorType: errorTypeCode, errorTypeDisplay: errorType });
        console.log(`[${chatId}] Сохранены ошибки в userErrorsByType для пользователя`);
      }
    } catch (error) {
      console.error(`[${chatId}] Ошибка в handleErrorTypeSelection:`, error);
      await ctx.reply('❌ Ошибка при получении списка ошибок по ценникам');
      this.userStates.delete(chatId);
    }
  }

  // Обработка выбора конкретной пустоты
  private async handleVoidSelection(ctx: Context, voidText: string) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    console.log(`[${chatId}] Пользователь выбрал пустоту: ${voidText}`);

    const userVoids = (this as any).userVoids?.get(chatId);
    if (!userVoids) {
      await ctx.reply('❌ Ошибка: пустоты не найдены. Попробуйте выбрать группу снова.');
      return;
    }

    const { voids, group } = userVoids;
    
    // Извлекаем информацию о полке и позиции из текста кнопки
    const match = voidText.match(/Полка (\d+) \/ Позиция (\d+)/);
    if (!match) {
      await ctx.reply('❌ Неверный формат выбора пустоты');
      return;
    }

    const shelfIndex = parseInt(match[1]);
    const position = parseInt(match[2]);
    
    // Находим выбранную пустоту
    const selectedVoid = voids.find(v => v.shelf_index === shelfIndex && v.position === position);
    if (!selectedVoid) {
      await ctx.reply('❌ Пустота не найдена');
      return;
    }

    // Показываем детальную информацию о пустоте
    const responseMessage = `🪑 **Детальная информация о пустоте:**

📍 **Расположение:** Полка ${selectedVoid.shelf_index} / Позиция ${selectedVoid.position}
🏷️ **Группа:** ${group.name}
📦 **Товар:** [${selectedVoid.sku}] ${selectedVoid.name}
📊 **Остатки:** ${selectedVoid.stock}

💡 Выберите действие:`;

    const keyboard: ReplyKeyboardMarkup = {
      keyboard: [
        ['✅ Выполнено'],
        ['❌ Отмена'],
        ['🔙 Назад', '🏠 На главную']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    };

    // Отправляем фото с описанием в одном сообщении, если фото есть
    if (selectedVoid.photo_url) {
      try {
        await ctx.replyWithPhoto(selectedVoid.photo_url, {
          caption: responseMessage,
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      } catch (error) {
        console.error(`[${chatId}] Ошибка при отправке фото:`, error);
        // Если не удалось отправить фото, отправляем только текст
        await ctx.reply(responseMessage, { reply_markup: keyboard, parse_mode: 'Markdown' });
      }
    } else {
      // Если фото нет, отправляем только текст
      await ctx.reply(responseMessage, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
    
    // Сохраняем выбранную пустоту для обработки действий
    if (chatId) {
      this.userStates.set(chatId, 'void_action');
      (this as any).selectedVoid = (this as any).selectedVoid || new Map();
      (this as any).selectedVoid.set(chatId, { void: selectedVoid, group });
    }
  }

  // Обработка выбора конкретной ошибки ценника
  private async handlePriceErrorSelection(ctx: Context, errorText: string) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    console.log(`[${chatId}] Пользователь выбрал ошибку ценника: ${errorText}`);

    const userPriceErrors = (this as any).userPriceErrors?.get(chatId);
    if (!userPriceErrors) {
      await ctx.reply('❌ Ошибка: ошибки ценников не найдены. Попробуйте выбрать группу снова.');
      return;
    }

    const { errors, group } = userPriceErrors;
    
    // Извлекаем информацию о полке и позиции из текста кнопки
    const match = errorText.match(/Полка (\d+) \/ Позиция (\d+)/);
    if (!match) {
      await ctx.reply('❌ Неверный формат выбора ошибки ценника');
      return;
    }

    const shelfIndex = parseInt(match[1]);
    const position = parseInt(match[2]);
    
    // Находим выбранную ошибку
    const selectedError = errors.find(e => e.shelf_index === shelfIndex && e.position === position);
    if (!selectedError) {
      await ctx.reply('❌ Ошибка ценника не найдена');
      return;
    }

    // Показываем детальную информацию об ошибке
    const responseMessage = `🏷️ **Детальная информация об ошибке ценника:**

📍 **Расположение:** Полка ${selectedError.shelf_index} / Позиция ${selectedError.position}
🏷️ **Группа:** ${group.name}
❌ **Тип ошибки:** ${this.getErrorTypeDisplayName(selectedError.error_type)}
📦 **Товар:** [${selectedError.sku || 'Не указан'}] ${selectedError.name || 'Без названия'}
${selectedError.details ? `📝 **Детали:** ${selectedError.details}\n` : ''}

💡 Выберите действие:`;

    const keyboard: ReplyKeyboardMarkup = {
      keyboard: [
        ['✅ Выполнено'],
        ['❌ Отмена'],
        ['🔙 Назад', '🏠 На главную']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    };

    // Отправляем фото с описанием в одном сообщении, если фото есть
    if (selectedError.photo_url) {
      try {
        await ctx.replyWithPhoto(selectedError.photo_url, {
          caption: responseMessage,
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      } catch (error) {
        console.error(`[${chatId}] Ошибка при отправке фото:`, error);
        // Если не удалось отправить фото, отправляем только текст
        await ctx.reply(responseMessage, { reply_markup: keyboard, parse_mode: 'Markdown' });
      }
    } else {
      // Если фото нет, отправляем только текст
      await ctx.reply(responseMessage, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
    
    // Сохраняем выбранную ошибку для обработки действий
    if (chatId) {
      this.userStates.set(chatId, 'price_error_action');
      (this as any).selectedPriceError = (this as any).selectedPriceError || new Map();
      (this as any).selectedPriceError.set(chatId, { error: selectedError, group });
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
    const originalGroupName = groupName.replace(/\s*\(ошибок:\s*\d+(?:,\s*типы:\s*[^)]+)?\)$/, '').replace(/\s*\(\?\)$/, '');
    
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

      // Создаем кнопки с краткой информацией об ошибках
      const errorButtons = [];
      
      for (const error of errors.slice(0, 8)) {
        const buttonText = `${this.getErrorTypeDisplayName(error.error_type)} - Полка ${error.shelf_index} / Позиция ${error.position} - [${error.sku || 'Не указан'}] ${error.name || 'Без названия'}`;
        errorButtons.push([buttonText]);
      }

      const keyboard: ReplyKeyboardMarkup = {
        keyboard: [
          ...errorButtons,
          ['🔙 Назад', '🏠 На главную']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
      };

      await ctx.reply(`🏷️ Выберите ошибку ценника в группе "${originalGroupName}":`, { reply_markup: keyboard });
      
      // Сохраняем ошибки и группу для следующего этапа
      if (chatId) {
        this.userStates.set(chatId, 'selecting_price_error');
        // Сохраняем ошибки и группу для этого пользователя
        (this as any).userPriceErrors = (this as any).userPriceErrors || new Map();
        (this as any).userPriceErrors.set(chatId, { errors, group: selectedGroup });
      }
    } catch (error) {
      await ctx.reply('❌ Ошибка при получении списка ошибок по ценникам в группе');
      this.userStates.delete(chatId);
      (this as any).userGroups.delete(chatId);
    }
  }

  // Обработка комментария для выполнения задачи
  private async handleTaskCompletionComment(ctx: Context, comment: string) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    console.log(`[${chatId}] Пользователь ввел комментарий для выполнения задачи: ${comment}`);

    const userState = this.userStates.get(chatId);
    if (userState === 'waiting_void_comment') {
      const selectedVoid = (this as any).selectedVoid?.get(chatId);
      if (selectedVoid) {
        try {
          const taskAction = {
            task_id: `void_${selectedVoid.void.shelf_index}_${selectedVoid.void.position}`,
            action: TaskActionTypes.DONE,
            comment: comment === '💬 Без комментария' ? null : comment
          };

          await this.shelfSenseService.markTaskAction(taskAction);
          
          const message = `✅ **Задача выполнена!**

📍 **Расположение:** Полка ${selectedVoid.void.shelf_index} / Позиция ${selectedVoid.void.position}
🏷️ **Группа:** ${selectedVoid.group.name}
📦 **Товар:** [${selectedVoid.void.sku}] ${selectedVoid.void.name}
${comment !== '💬 Без комментария' ? `💬 **Комментарий:** ${comment}\n` : ''}
🎯 Задача успешно отмечена как выполненная в системе.`;

          const keyboard: ReplyKeyboardMarkup = {
            keyboard: [
              ['🔙 Назад', '🏠 На главную']
            ],
            resize_keyboard: true,
            one_time_keyboard: false
          };

          await ctx.reply(message, { reply_markup: keyboard, parse_mode: 'Markdown' });
          
          // Очищаем состояние
          this.userStates.delete(chatId);
          (this as any).selectedVoid.delete(chatId);
          (this as any).userVoids.delete(chatId);
          (this as any).userGroups.delete(chatId);
        } catch (error) {
          console.error(`[${chatId}] Ошибка при выполнении задачи:`, error);
          await ctx.reply('❌ Ошибка при выполнении задачи. Попробуйте позже.');
          this.userStates.delete(chatId);
          (this as any).selectedVoid.delete(chatId);
          (this as any).userVoids.delete(chatId);
          (this as any).userGroups.delete(chatId);
        }
      }
    } else if (userState === 'waiting_price_error_comment') {
      const selectedPriceError = (this as any).selectedPriceError?.get(chatId);
      if (selectedPriceError) {
        try {
          const taskAction = {
            task_id: `price_error_${selectedPriceError.error.shelf_index}_${selectedPriceError.error.position}`,
            action: TaskActionTypes.DONE,
            comment: comment === '💬 Без комментария' ? null : comment
          };

          await this.shelfSenseService.markTaskAction(taskAction);
          
          const message = `✅ **Ошибка ценника исправлена!**

📍 **Расположение:** Полка ${selectedPriceError.error.shelf_index} / Позиция ${selectedPriceError.error.position}
🏷️ **Группа:** ${selectedPriceError.group.name}
❌ **Тип ошибки:** ${this.getErrorTypeDisplayName(selectedPriceError.error.error_type)}
📦 **Товар:** [${selectedPriceError.error.sku || 'Не указан'}] ${selectedPriceError.error.name || 'Без названия'}
${comment !== '💬 Без комментария' ? `💬 **Комментарий:** ${comment}\n` : ''}
🎯 Ошибка успешно отмечена как исправленная в системе.`;

          const keyboard: ReplyKeyboardMarkup = {
            keyboard: [
              ['🔙 Назад', '🏠 На главную']
            ],
            resize_keyboard: true,
            one_time_keyboard: false
          };

          await ctx.reply(message, { reply_markup: keyboard, parse_mode: 'Markdown' });
          
          // Очищаем состояние
          this.userStates.delete(chatId);
          (this as any).selectedPriceError.delete(chatId);
          (this as any).userPriceErrors.delete(chatId);
          (this as any).userGroups.delete(chatId);
        } catch (error) {
          console.error(`[${chatId}] Ошибка при исправлении задачи:`, error);
          await ctx.reply('❌ Ошибка при исправлении задачи. Попробуйте позже.');
          this.userStates.delete(chatId);
          (this as any).selectedPriceError.delete(chatId);
          (this as any).userPriceErrors.delete(chatId);
          (this as any).userGroups.delete(chatId);
        }
      }
    }
  }

  // Обработка комментария для отмены задачи
  private async handleTaskCancellationComment(ctx: Context, comment: string) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    console.log(`[${chatId}] Пользователь ввел комментарий для отмены задачи: ${comment}`);

    const userState = this.userStates.get(chatId);
    if (userState === 'waiting_void_cancel_comment') {
      const selectedVoid = (this as any).selectedVoid?.get(chatId);
      if (selectedVoid) {
        try {
          const taskAction = {
            task_id: `void_${selectedVoid.void.shelf_index}_${selectedVoid.void.position}`,
            action: TaskActionTypes.DECLINE,
            comment: comment === '💬 Без комментария' ? null : comment
          };

          await this.shelfSenseService.markTaskAction(taskAction);
          
          const message = `❌ **Задача отменена!**

📍 **Расположение:** Полка ${selectedVoid.void.shelf_index} / Позиция ${selectedVoid.void.position}
🏷️ **Группа:** ${selectedVoid.group.name}
📦 **Товар:** [${selectedVoid.void.sku}] ${selectedVoid.void.name}
${comment !== '💬 Без комментария' ? `💬 **Причина отмены:** ${comment}\n` : ''}
🎯 Задача успешно отменена в системе.`;

          const keyboard: ReplyKeyboardMarkup = {
            keyboard: [
              ['🔙 Назад', '🏠 На главную']
            ],
            resize_keyboard: true,
            one_time_keyboard: false
          };

          await ctx.reply(message, { reply_markup: keyboard, parse_mode: 'Markdown' });
          
          // Очищаем состояние
          this.userStates.delete(chatId);
          (this as any).selectedVoid.delete(chatId);
          (this as any).userVoids.delete(chatId);
          (this as any).userGroups.delete(chatId);
        } catch (error) {
          console.error(`[${chatId}] Ошибка при отмене задачи:`, error);
          await ctx.reply('❌ Ошибка при отмене задачи. Попробуйте позже.');
          this.userStates.delete(chatId);
          (this as any).selectedVoid.delete(chatId);
          (this as any).userVoids.delete(chatId);
          (this as any).userGroups.delete(chatId);
        }
      }
    } else if (userState === 'waiting_price_error_cancel_comment') {
      const selectedPriceError = (this as any).selectedPriceError?.get(chatId);
      if (selectedPriceError) {
        try {
          const taskAction = {
            task_id: `price_error_${selectedPriceError.error.shelf_index}_${selectedPriceError.error.position}`,
            action: TaskActionTypes.DECLINE,
            comment: comment === '💬 Без комментария' ? null : comment
          };

          await this.shelfSenseService.markTaskAction(taskAction);
          
          const message = `❌ **Исправление ошибки ценника отменено!**

📍 **Расположение:** Полка ${selectedPriceError.error.shelf_index} / Позиция ${selectedPriceError.error.position}
🏷️ **Группа:** ${selectedPriceError.group.name}
❌ **Тип ошибки:** ${this.getErrorTypeDisplayName(selectedPriceError.error.error_type)}
📦 **Товар:** [${selectedPriceError.error.sku || 'Не указан'}] ${selectedPriceError.error.name || 'Без названия'}
${comment !== '💬 Без комментария' ? `💬 **Причина отмены:** ${comment}\n` : ''}
🎯 Отмена успешно зафиксирована в системе.`;

          const keyboard: ReplyKeyboardMarkup = {
            keyboard: [
              ['🔙 Назад', '🏠 На главную']
            ],
            resize_keyboard: true,
            one_time_keyboard: false
          };

          await ctx.reply(message, { reply_markup: keyboard, parse_mode: 'Markdown' });
          
          // Очищаем состояние
          this.userStates.delete(chatId);
          (this as any).selectedPriceError.delete(chatId);
          (this as any).userPriceErrors.delete(chatId);
          (this as any).userGroups.delete(chatId);
        } catch (error) {
          console.error(`[${chatId}] Ошибка при отмене задачи:`, error);
          await ctx.reply('❌ Ошибка при отмене задачи. Попробуйте позже.');
          this.userStates.delete(chatId);
          (this as any).selectedPriceError.delete(chatId);
          (this as any).userPriceErrors.delete(chatId);
          (this as any).userGroups.delete(chatId);
        }
      }
    }
  }

  // Обработка выбора конкретной ошибки по типу
  private async handleErrorByTypeSelection(ctx: Context, errorText: string) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    console.log(`[${chatId}] Пользователь выбрал ошибку по типу: ${errorText}`);

    const userErrorsByType = (this as any).userErrorsByType?.get(chatId);
    if (!userErrorsByType) {
      await ctx.reply('❌ Ошибка: ошибки не найдены. Попробуйте выбрать тип ошибки снова.');
      return;
    }

    const { errors, errorType, errorTypeDisplay } = userErrorsByType;
    
    // Извлекаем информацию о полке и позиции из текста кнопки
    const match = errorText.match(/Полка (\d+) \/ Позиция (\d+)/);
    if (!match) {
      await ctx.reply('❌ Неверный формат выбора ошибки');
      return;
    }

    const shelfIndex = parseInt(match[1]);
    const position = parseInt(match[2]);
    
    // Находим выбранную ошибку
    const selectedError = errors.find(e => e.shelf_index === shelfIndex && e.position === position);
    if (!selectedError) {
      await ctx.reply('❌ Ошибка не найдена');
      return;
    }

    // Показываем детальную информацию об ошибке
    const responseMessage = `🏷️ **Детальная информация об ошибке ценника:**

📍 **Расположение:** Полка ${selectedError.shelf_index} / Позиция ${selectedError.position}
🏷️ **Группа:** ${selectedError.merch_group.name}
❌ **Тип ошибки:** ${this.getErrorTypeDisplayName(selectedError.error_type)}
📦 **Товар:** [${selectedError.sku || 'Не указан'}] ${selectedError.name || 'Без названия'}
${selectedError.details ? `📝 **Детали:** ${selectedError.details}\n` : ''}

💡 Выберите действие:`;

    const keyboard: ReplyKeyboardMarkup = {
      keyboard: [
        ['✅ Выполнено'],
        ['❌ Отмена'],
        ['🔙 Назад', '🏠 На главную']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    };

    // Отправляем фото с описанием в одном сообщении, если фото есть
    if (selectedError.photo_url) {
      try {
        await ctx.replyWithPhoto(selectedError.photo_url, {
          caption: responseMessage,
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      } catch (error) {
        console.error(`[${chatId}] Ошибка при отправке фото:`, error);
        // Если не удалось отправить фото, отправляем только текст
        await ctx.reply(responseMessage, { reply_markup: keyboard, parse_mode: 'Markdown' });
      }
    } else {
      // Если фото нет, отправляем только текст
      await ctx.reply(responseMessage, { reply_markup: keyboard, parse_mode: 'Markdown' });
    }
    
    // Сохраняем выбранную ошибку для обработки действий
    if (chatId) {
      this.userStates.set(chatId, 'price_error_action');
      (this as any).selectedPriceError = (this as any).selectedPriceError || new Map();
      (this as any).selectedPriceError.set(chatId, { error: selectedError, group: selectedError.merch_group });
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
       case 'select_price_group':
         // Возвращаемся в меню ценников
         await this.showPriceTagsMenu(ctx, false);
         break;
      case 'select_error_type':
        await this.showPriceTagsMenu(ctx, false); // Возвращаемся в меню ценников
        break;
      case 'selecting_error_by_type':
        // Возвращаемся к выбору типа ошибки
        await this.onSelectErrorType(ctx);
        break;
      case 'waiting_void_comment':
      case 'waiting_price_error_comment':
      case 'waiting_void_cancel_comment':
      case 'waiting_price_error_cancel_comment':
        // Возвращаемся к выбору конкретной пустоты/ошибки
        const currentUserState = this.userStates.get(chatId);
        if (currentUserState === 'waiting_void_comment' || currentUserState === 'waiting_void_cancel_comment') {
          // Возвращаемся к выбору пустоты
          const userVoids = (this as any).userVoids?.get(chatId);
          if (userVoids) {
            const { voids, group } = userVoids;
            const selectedVoid = (this as any).selectedVoid?.get(chatId);
            if (selectedVoid) {
              // Показываем детальную информацию о пустоте снова
              const responseMessage = `🪑 **Детальная информация о пустоте:**

📍 **Расположение:** Полка ${selectedVoid.void.shelf_index} / Позиция ${selectedVoid.void.position}
🏷️ **Группа:** ${group.name}
📦 **Товар:** [${selectedVoid.void.sku}] ${selectedVoid.void.name}
📊 **Остатки:** ${selectedVoid.void.stock}

💡 Выберите действие:`;

              const keyboard: ReplyKeyboardMarkup = {
                keyboard: [
                  ['✅ Выполнено'],
                  ['❌ Отмена'],
                  ['🔙 Назад', '🏠 На главную']
                ],
                resize_keyboard: true,
                one_time_keyboard: false
              };

              // Отправляем фото с описанием в одном сообщении, если фото есть
              if (selectedVoid.void.photo_url) {
                try {
                  await ctx.replyWithPhoto(selectedVoid.void.photo_url, {
                    caption: responseMessage,
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                  });
                } catch (error) {
                  console.error(`[${chatId}] Ошибка при отправке фото:`, error);
                  // Если не удалось отправить фото, отправляем только текст
                  await ctx.reply(responseMessage, { reply_markup: keyboard, parse_mode: 'Markdown' });
                }
              } else {
                // Если фото нет, отправляем только текст
                await ctx.reply(responseMessage, { reply_markup: keyboard, parse_mode: 'Markdown' });
              }

              this.userStates.set(chatId, 'void_action');
            }
          }
        } else if (currentUserState === 'waiting_price_error_comment' || currentUserState === 'waiting_price_error_cancel_comment') {
          // Возвращаемся к выбору ошибки ценника
          const userPriceErrors = (this as any).userPriceErrors?.get(chatId);
          if (userPriceErrors) {
            const { errors, group } = userPriceErrors;
            const selectedPriceError = (this as any).selectedPriceError?.get(chatId);
            if (selectedPriceError) {
              // Показываем детальную информацию об ошибке снова
              const responseMessage = `🏷️ **Детальная информация об ошибке ценника:**

📍 **Расположение:** Полка ${selectedPriceError.error.shelf_index} / Позиция ${selectedPriceError.error.position}
🏷️ **Группа:** ${group.name}
❌ **Тип ошибки:** ${this.getErrorTypeDisplayName(selectedPriceError.error.error_type)}
📦 **Товар:** [${selectedPriceError.error.sku || 'Не указан'}] ${selectedPriceError.error.name || 'Без названия'}
${selectedPriceError.error.details ? `📝 **Детали:** ${selectedPriceError.error.details}\n` : ''}

💡 Выберите действие:`;

              const keyboard: ReplyKeyboardMarkup = {
                keyboard: [
                  ['✅ Выполнено'],
                  ['❌ Отмена'],
                  ['🔙 Назад', '🏠 На главную']
                ],
                resize_keyboard: true,
                one_time_keyboard: false
              };

              // Отправляем фото с описанием в одном сообщении, если фото есть
              if (selectedPriceError.error.photo_url) {
                try {
                  await ctx.replyWithPhoto(selectedPriceError.error.photo_url, {
                    caption: responseMessage,
                    parse_mode: 'Markdown',
                    reply_markup: keyboard
                  });
                } catch (error) {
                  console.error(`[${chatId}] Ошибка при отправке фото:`, error);
                  // Если не удалось отправить фото, отправляем только текст
                  await ctx.reply(responseMessage, { reply_markup: keyboard, parse_mode: 'Markdown' });
                }
              } else {
                // Если фото нет, отправляем только текст
                await ctx.reply(responseMessage, { reply_markup: keyboard, parse_mode: 'Markdown' });
              }

              this.userStates.set(chatId, 'price_error_action');
            }
          }
        }
        break;
      default:
        console.log(`[${chatId}] Неизвестная страница в истории: ${previousPage}, возвращаемся на главную`);
        await this.onBackToMain(ctx);
        break;
    }
  }
}
