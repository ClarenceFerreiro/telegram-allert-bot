# 🤖 Telegram Alert Bot

Telegram-бот для мониторинга и управления **GitHub Actions** — статусы запусков, алерты, запуск workflows, ссылки на Allure-отчёты. Работает в режиме **long polling** (не требует публичного URL).

## Возможности

- 📊 **Реальный статус** GitHub Actions через GitHub API
- 🚨 **Алерты** — последние неудачные/отменённые запуски
- 🚀 **Запуск workflows** напрямую из Telegram
- 🔗 **Ссылки на Allure-отчёты** (GitHub Pages)
- 📂 **Несколько репозиториев** — отслеживание в одном боте
- 🔒 **Ограничение доступа** по Telegram user ID
- 🔄 **Long polling** — не нужен webhook и публичный URL

## Стек

| Компонент | Технология |
|---|---|
| Telegram-библиотека | [grammY](https://grammy.dev/) (long polling) |
| HTTP-клиент | axios |
| Хостинг | [Render](https://render.com) (free tier) |
| Runtime | Node.js ≥ 18 |

## Команды бота

| Команда | Описание |
|---|---|
| `/start` | Приветствие |
| `/help` | Список всех команд |
| `/status` | Реальный статус последних GitHub Actions runs (по всем репозиториям) |
| `/last` | Последние 5 запусков тестов с датами и ссылками |
| `/alerts` | Последние неудачные / отменённые запуски (алерты) |
| `/run` | Запуск workflow через GitHub API. По умолчанию `allure-report.yml` на ветке `main`. Можно указать аргументы: `/run allure-ts.yml develop` |
| `/report` | Ссылки на Allure-отчёты (GitHub Pages) |
| `/repos` | Список отслеживаемых репозиториев |

## Переменные окружения

| Переменная | Обязательная | Описание |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | Токен бота от [@BotFather](https://t.me/BotFather) |
| `PAT_TOKEN` | ✅ | GitHub Personal Access Token со scopes: `repo`, `workflow` |
| `TELEGRAM_USER_ID` | ⬜ | Telegram user ID для ограничения доступа (если не задан — доступ открыт всем) |
| `GITHUB_REPOS` | ⬜ | Список репозиториев через запятую (`owner/repo`). По умолчанию: `ClarenceFerreiro/postman-api-tests` |
| `DEFAULT_WORKFLOW` | ⬜ | Workflow для запуска командой `/run` (имя файла). По умолчанию: `allure-report.yml` |
| `DEFAULT_BRANCH` | ⬜ | Ветка для запуска workflow. По умолчанию: `main` |
| `REPORT_BASE_URL` | ⬜ | Базовый URL Allure-отчётов. По умолчанию: `https://clarenceferreiro.github.io/postman-api-tests/` |

> ⚠️ **Важно:** `PAT_TOKEN` должен иметь scopes `repo` и `workflow` для запуска workflows и доступа к Actions API.

## Локальный запуск

### 1. Клонирование

```bash
git clone https://github.com/ClarenceFerreiro/telegram-allert-bot.git
cd telegram-allert-bot
```

### 2. Установка зависимостей

```bash
npm install
```

### 3. Настройка переменных окружения

```bash
cp .env.example .env
# Отредактируйте .env — впишите реальные значения
```

### 4. Запуск

```bash
npm start
```

Бот запустится в режиме long polling. Откройте Telegram и отправьте `/start` вашему боту.

> 💡 Для загрузки `.env` при локальном запуске можно использовать `dotenv` или передать переменные напрямую:
> ```bash
> export $(cat .env | xargs) && npm start
> ```

## Деплой на Render

[Render](https://render.com) предоставляет free tier для web-сервисов.

### Способ 1: через render.yaml (Blueprint)

1. Зайдите на [dashboard.render.com](https://dashboard.render.com)
2. Нажмите **New** → **Blueprint**
3. Выберите репозиторий `ClarenceFerreiro/telegram-allert-bot`
4. Render автоматически распознает `render.yaml` и создаст сервис
5. Заполните секретные переменные в настройках сервиса:
   - `TELEGRAM_BOT_TOKEN` — токен бота
   - `PAT_TOKEN` — GitHub PAT
   - `TELEGRAM_USER_ID` — ваш Telegram ID
6. Нажмите **Apply** — Render соберёт и запустит бота

### Способ 2: вручную

1. **New** → **Web Service**
2. Выберите репозиторий `ClarenceFerreiro/telegram-allert-bot`
3. Настройки:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node bot.js`
   - **Plan:** Free
4. Добавьте переменные окружения (см. таблицу выше)
5. Нажмите **Create Web Service**

### Проверка деплоя

После успешного деплоя в логах Render должно появиться:

```
🤖 Запуск Telegram Alert Bot (long polling)...
📂 Отслеживаемые репозитории: ClarenceFerreiro/postman-api-tests
✅ Бот @your_bot_name запущен и готов к работе!
```

Откройте Telegram и отправьте боту `/help`.

> ℹ️ На free tier Render сервис может «засыпать» после 15 минут неактивности. При следующем запросе он просыпается за несколько секунд. Для бота в polling-режиме это не проблема — grammY автоматически переподключается.

## Получение токенов

### Telegram Bot Token

1. Откройте [@BotFather](https://t.me/BotFather) в Telegram
2. Отправьте `/newbot`
3. Задайте имя и username бота
4. Получите токен вида `123456:ABC-DEF...`

### GitHub Personal Access Token

1. Откройте [github.com/settings/tokens](https://github.com/settings/tokens)
2. **Generate new token (classic)**
3. Выберите scopes: `repo` (полный) и `workflow`
4. Скопируйте токен (виден только один раз)

### Telegram User ID

1. Откройте [@userinfobot](https://t.me/userinfobot) в Telegram
2. Отправьте `/start`
3. Бот вернёт ваш ID (например, `405995403`)

## Структура проекта

```
telegram-allert-bot/
├── bot.js           # Основной код бота (grammY, polling)
├── package.json     # Зависимости и скрипты
├── render.yaml      # Конфигурация деплоя на Render
├── .env.example     # Пример переменных окружения
├── .gitignore       # Исключения Git
└── README.md        # Документация
```

## Связанные репозитории

- [ClarenceFerreiro/postman-api-tests](https://github.com/ClarenceFerreiro/postman-api-tests) — тесты и Allure-отчёты, которые бот запускает и показывает

## Лицензия

MIT