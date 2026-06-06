# telegram-test-bot

Telegram-бот для управления QA-тестами через GitHub Actions. Работает по webhook, деплоится на Railway.

## Возможности

- `/start` — приветствие и список команд
- `/status` — быстрый статус по тестам (Postman / TypeScript / Playwright)
- `/report` — ссылки на Allure-отчёты
- `/run` — запуск GitHub Actions workflow `allure-report.yml`

## Стек

- Node.js + Express (webhook-сервер)
- axios (HTTP-запросы к Telegram API и GitHub API)
- Railway (хостинг)

## Переменные окружения

| Переменная | Описание |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Токен бота от [@BotFather](https://t.me/BotFather) |
| `PAT_TOKEN` | GitHub Personal Access Token с правом `repo` |
| `PORT` | Порт сервера (по умолчанию `8080`) |

## Установка и запуск

```bash
npm install
TELEGRAM_BOT_TOKEN=xxx PAT_TOKEN=xxx npm start
```

## Деплой на Railway

1. Подключи репозиторий в [Railway Dashboard](https://railway.app)
2. Добавь переменные окружения `TELEGRAM_BOT_TOKEN` и `PAT_TOKEN`
3. Railway подхватит `railway.json` и запустит бота автоматически

## Настройка Telegram webhook

После деплоя установи webhook:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://<твой-railway-домен>/<TELEGRAM_BOT_TOKEN>"
```

## Связанные репозитории

- [ClarenceFerreiro/postman-api-tests](https://github.com/ClarenceFerreiro/postman-api-tests) — тесты и отчёты, которые бот запускает и показывает
