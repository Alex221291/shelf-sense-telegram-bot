# ShelfSense Telegram Bot

Телеграм-бот для интеграции с API ShelfSense, позволяющий управлять выкладкой товаров и ценниками через удобный интерфейс.

## 🚀 Возможности

- 📊 Получение сводок по выкладке товаров
- 🏷️ Управление ценниками и их ошибками
- 🔍 Поиск пустот в мерч-группах
- 📋 Работа с мерч-группами
- 🖨️ Генерация PDF с ценниками
- ✅ Отметка выполнения заданий

## 🛠️ Технологии

- **NestJS** - фреймворк для создания серверных приложений
- **@nestjs/telegraf** - интеграция с Telegram Bot API
- **Axios** - HTTP клиент для работы с внешним API
- **TypeScript** - типизированный JavaScript

## 📦 Установка

1. Клонируйте репозиторий:
```bash
git clone <repository-url>
cd shelf-sense-telegram-bot
```

2. Установите зависимости:
```bash
npm install
```

3. Создайте файл `.env` на основе `env.example`:
```bash
cp env.example .env
```

4. Настройте переменные окружения в `.env`:
```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
SHELF_SENSE_API_URL=http://localhost:8000
PORT=3000
NODE_ENV=development
```

## 🔧 Настройка Telegram Bot

1. Создайте бота через [@BotFather](https://t.me/botfather)
2. Получите токен бота
3. Добавьте токен в файл `.env`

## 🚀 Запуск

### Режим разработки
```bash
npm run start:dev
```

### Продакшн сборка
```bash
npm run build
npm run start:prod
```

## 📱 Команды бота

### Основные команды
- `/start` - Начать работу с ботом
- `/help` - Показать справку по командам

### Сводки
- `/merchgroups` - Список мерч-групп
- `/shelf_summary` - Сводка по выкладке товара
- `/price_summary` - Сводка по ценникам

### Детальная информация
- `/voids` - Инструкция по получению пустот
- `/voids_group [ID]` - Пустоты в конкретной группе
- `/price_errors` - Инструкция по получению ошибок
- `/price_errors_type [ТИП]` - Ошибки по типу
- `/price_errors_group [ID]` - Ошибки в группе

### Действия
- `/generate_pdf` - Сгенерировать PDF с ценниками

## 🔌 API Endpoints

Бот интегрируется со следующими эндпоинтами ShelfSense API:

- `GET /merchgroups` - Получение мерч-групп
- `GET /shelves/summary` - Сводка по выкладке
- `GET /shelves/merchgroup/{group_id}/voids/tasks` - Пустоты в группе
- `GET /prices/summary` - Сводка по ценникам
- `GET /prices/errortype/{error_type}/tasks` - Ошибки по типу
- `GET /prices/merchgroup/{merch_group_id}/tasks` - Ошибки в группе
- `POST /tasks/action` - Отметка выполнения задания
- `GET /price_tags/pdf` - Генерация PDF с ценниками

## 📁 Структура проекта

```
src/
├── types/
│   └── shelf-sense.types.ts    # Типы и интерфейсы API
├── dto/
│   └── shelf-sense.dto.ts      # DTO для валидации
├── services/
│   └── shelf-sense.service.ts  # Сервис для работы с API
├── telegram/
│   ├── telegram.module.ts       # Модуль телеграм-бота
│   └── telegram-bot.service.ts # Сервис телеграм-бота
├── app.module.ts                # Главный модуль приложения
└── main.ts                      # Точка входа
```

## 🧪 Тестирование

```bash
# Запуск тестов
npm run test

# Запуск тестов в режиме наблюдения
npm run test:watch

# Покрытие кода тестами
npm run test:cov
```

## 📝 Логирование

Бот выводит логи в консоль:
- 🚀 Запуск приложения
- 📱 Готовность бота к работе
- ❌ Ошибки при работе с API

## 🔒 Безопасность

- Все API ключи хранятся в переменных окружения
- Валидация входящих данных через DTO
- Обработка ошибок API с информативными сообщениями

## 🤝 Разработка

### Добавление новых команд

1. Создайте метод в `TelegramBotService`
2. Добавьте декоратор `@Command('command_name')`
3. Обновите справку в методе `helpCommand`

### Добавление новых API методов

1. Добавьте метод в `ShelfSenseService`
2. Создайте соответствующие типы в `shelf-sense.types.ts`
3. Добавьте команду в телеграм-бот

## 📄 Лицензия

Проект создан для внутреннего использования.

## 🆘 Поддержка

При возникновении проблем:
1. Проверьте логи приложения
2. Убедитесь в корректности переменных окружения
3. Проверьте доступность ShelfSense API
4. Убедитесь в валидности токена Telegram бота