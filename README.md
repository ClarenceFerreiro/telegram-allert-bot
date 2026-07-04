# telegram-allert-bot

Telegram-бот для мониторинга и управления GitHub Actions. Работает в режиме long polling (grammY) — публичный URL не требуется.

## Возможности

- `/start` — приветствие
- `/help` — список всех команд
- `/status` — реальный статус последних GitHub Actions runs (API запрос)
- `/last` — последние 5 запусков тестов с датами и статусами
- `/alerts` — последние неудачные/отменённые запуски
- `/run` — запуск workflow через GitHub API (по умолчанию `allure-report.yml`)
- `/report` — ссылки на Allure-отчёты (GitHub Pages)
- `/repos` — список отслеживаемых репозиториев

## Стек

- **Node.js 18+** + **grammY** (Telegram Bot API framework, polling mode)
- **axios** (HTTP-запросы к GitHub API)
- **Railway** или **Render** (хостинг, free tier)

## Переменные окружения

| Переменная | Описание | Обязательно |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Токен бота от [@BotFather](https://t.me/BotFather) | ✅ |
| `PAT_TOKEN` | GitHub Personal Access Token (scopes: `repo`, `workflow`) | ✅ |
| `TELEGRAM_USER_ID` | Telegram user ID для ограничения доступа | рекомендуется |
| `GITHUB_REPOS` | Список репозиториев через запятую (`owner/repo`) | нет (по умолчанию `ClarenceFerreiro/postman-api-tests`) |
| `DEFAULT_WORKFLOW` | Workflow для `/run` (имя файла) | нет (по умолчанию `allure-report.yml`) |
| `DEFAULT_BRANCH` | Ветка для запуска | нет (по умолчанию `main`) |
| `REPORT_BASE_URL` | Базовый URL Allure-отчётов | нет (по умолчанию GitHub Pages) |

## Установка и локальный запуск

```bash
git clone https://github.com/ClarenceFerreiro/telegram-allert-bot.git
cd telegram-allert-bot
npm install
cp .env.example .env
# Отредактируйте .env — заполните TELEGRAM_BOT_TOKEN и PAT_TOKEN
npm start
```

## Деплой на Railway (Free plan)

Railway предлагает free plan: $0/мес, 30-day trial с $5 credits, затем $1/мес.
Без credit card для старта. 1 vCPU / 0.5 GB RAM — достаточно для бота.

1. Зайди на [railway.app](https://railway.app) → Login with GitHub
2. **New Project** → **Deploy from GitHub repo** → выбери `telegram-allert-bot`
3. Railway подхватит `railway.json` автоматически
4. Добавь переменные окружения (Settings → Variables):
   - `TELEGRAM_BOT_TOKEN` — токен бота
   - `PAT_TOKEN` — GitHub PAT (scopes: `repo`, `workflow`)
   - `TELEGRAM_USER_ID` — `405995403`
5. Deploy → бот запустится в polling режиме

## Деплой на Render (Free tier)

1. Зайди на [render.com](https://render.com) → Sign up with GitHub
2. **New+** → **Web Service** → выбери `telegram-allert-bot`
3. Render подхватит `render.yaml` автоматически
4. Добавь переменные окружения (Environment):
   - `TELEGRAM_BOT_TOKEN` — токен бота
   - `PAT_TOKEN` — GitHub PAT (scopes: `repo`, `workflow`)
   - `TELEGRAM_USER_ID` — `405995403`
5. Create Web Service → бот запустится автоматически

## Безопасность

- Бот использует **long polling** — не требует публичного URL
- Доступ ограничен по `TELEGRAM_USER_ID` (только указанный пользователь может управлять ботом)
- При старте бот автоматически удаляет старый webhook (`deleteWebhook`)
- Токены передаются только через переменные окружения, не через код

## Связанные репозитории

- [ClarenceFerreiro/postman-api-tests](https://github.com/ClarenceFerreiro/postman-api-tests) — тесты и отчёты
- [ClarenceFerreiro/netgrid-monitor](https://github.com/ClarenceFerreiro/netgrid-monitor) — мониторинг сайтов

## Bot Token

Бот: `@testsQAalertt_bot` (QAalertbot, ID: 8591899224)
