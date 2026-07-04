/**
 * Telegram Alert Bot
 * ------------------
 * Мониторинг и управление GitHub Actions через Telegram.
 * Работает в режиме long polling (grammY) — публичный URL не требуется.
 *
 * Команды:
 *   /start   — приветствие
 *   /help    — список команд
 *   /status  — реальный статус последних GitHub Actions runs
 *   /report  — ссылки на Allure-отчёты (GitHub Pages)
 *   /run     — запуск workflow через GitHub API
 *   /repos   — список отслеживаемых репозиториев
 *   /alerts  — последние неудачные/ошибочные запуски
 *   /last    — последние 5 запусков тестов
 */

const { Bot } = require('grammy');
const axios = require('axios');

// ──────────────────────────────────────────────────────────────
//  Конфигурация из переменных окружения
// ──────────────────────────────────────────────────────────────
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GITHUB_TOKEN = process.env.PAT_TOKEN;
const ALLOWED_USER_ID = process.env.TELEGRAM_USER_ID
  ? Number(process.env.TELEGRAM_USER_ID)
  : null;

// Список отслеживаемых репозиториев (owner/repo)
const REPOS = (process.env.GITHUB_REPOS || 'ClarenceFerreiro/postman-api-tests')
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);

// Workflow для запуска командой /run (по умолчанию allure-report.yml)
const DEFAULT_WORKFLOW = process.env.DEFAULT_WORKFLOW || 'allure-report.yml';
const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH || 'main';

// Базовый URL для Allure-отчётов на GitHub Pages
const REPORT_BASE_URL =
  process.env.REPORT_BASE_URL ||
  'https://clarenceferreiro.github.io/postman-api-tests/';

// ──────────────────────────────────────────────────────────────
//  Валидация конфигурации
// ──────────────────────────────────────────────────────────────
if (!TELEGRAM_BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN не задан. Установите переменную окружения.');
  process.exit(1);
}
if (!GITHUB_TOKEN) {
  console.error('❌ PAT_TOKEN не задан. Установите переменную окружения.');
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────
//  HTTP-клиент для GitHub API
// ──────────────────────────────────────────────────────────────
const github = axios.create({
  baseURL: 'https://api.github.com',
  timeout: 15000,
  headers: {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  },
});

// ──────────────────────────────────────────────────────────────
//  Создание бота
// ──────────────────────────────────────────────────────────────
const bot = new Bot(TELEGRAM_BOT_TOKEN);

// Middleware: ограничение доступа по user ID (если задан)
bot.use((ctx, next) => {
  if (ALLOWED_USER_ID !== null && ctx.from?.id !== ALLOWED_USER_ID) {
    console.warn(`🚫 Доступ запрещён для пользователя ${ctx.from?.id} (${ctx.from?.username || '—'})`);
    return ctx.reply('🚫 У вас нет доступа к этому боту.');
  }
  return next();
});

// ──────────────────────────────────────────────────────────────
//  Вспомогательные функции
// ──────────────────────────────────────────────────────────────

/**
 * Форматирование статуса run с эмодзи.
 * @param {string} status
 * @param {string|null} conclusion
 * @returns {string}
 */
function formatRunStatus(status, conclusion) {
  if (status === 'completed') {
    if (conclusion === 'success') return '✅ Успех';
    if (conclusion === 'failure') return '❌ Провал';
    if (conclusion === 'cancelled') return '🚫 Отменён';
    if (conclusion === 'skipped') return '⏭️ Пропущен';
    return `⚪ ${conclusion || 'неизвестно'}`;
  }
  if (status === 'in_progress') return '🔄 Выполняется';
  if (status === 'queued') return '⏳ В очереди';
  if (status === 'waiting') return '⏳ Ожидание';
  return `ℹ️ ${status}`;
}

/**
 * Запрос последних runs для репозитория.
 * @param {string} repo — owner/repo
 * @param {number} perPage — количество
 * @returns {Promise<Array>}
 */
async function getRecentRuns(repo, perPage = 5) {
  const { data } = await github.get(`/repos/${repo}/actions/runs`, {
    params: { per_page: perPage, page: 1 },
  });
  return data.workflow_runs || [];
}

/**
 * Получение списка workflows репозитория.
 * @param {string} repo
 * @returns {Promise<Array>}
 */
async function getWorkflows(repo) {
  const { data } = await github.get(`/repos/${repo}/actions/workflows`);
  return data.workflows || [];
}

/**
 * Безопасная обработка ошибок — возвращает читаемое сообщение.
 * @param {Error} err
 * @returns {string}
 */
function describeError(err) {
  if (err.response) {
    const gh = err.response.data;
    const msg =
      gh?.message ||
      gh?.error ||
      `GitHub API: ${err.response.status} ${err.response.statusText}`;
    return `❌ ${msg}`;
  }
  return `❌ ${err.message || 'Неизвестная ошибка'}`;
}

// ──────────────────────────────────────────────────────────────
//  Команды
// ──────────────────────────────────────────────────────────────

bot.command('start', async (ctx) => {
  await ctx.reply(
    '🤖 *Telegram Alert Bot*\n\n' +
      'Бот для мониторинга и управления GitHub Actions.\n' +
      'Используйте /help для списка всех команд.',
    { parse_mode: 'Markdown' }
  );
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    '📋 *Команды бота:*\n\n' +
      '/start — приветствие\n' +
      '/help — этот список команд\n' +
      '/status — статус последних GitHub Actions runs\n' +
      '/last — последние 5 запусков тестов\n' +
      '/alerts — последние неудачные запуски\n' +
      '/run — запуск workflow (по умолчанию allure-report.yml)\n' +
      '/report — ссылки на Allure-отчёты\n' +
      '/repos — список отслеживаемых репозиториев',
    { parse_mode: 'Markdown' }
  );
});

bot.command('repos', async (ctx) => {
  const lines = REPOS.map((r, i) => `${i + 1}. [${r}](https://github.com/${r})`).join('\n');
  await ctx.reply(`📂 *Отслеживаемые репозитории:*\n\n${lines}`, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  });
});

bot.command('status', async (ctx) => {
  let text = '📊 *Статус GitHub Actions:*\n\n';
  for (const repo of REPOS) {
    try {
      const runs = await getRecentRuns(repo, 3);
      if (runs.length === 0) {
        text += `*${repo}*\n— нет запусков\n\n`;
        continue;
      }
      text += `*${repo}*\n`;
      for (const run of runs) {
        const status = formatRunStatus(run.status, run.conclusion);
        text += `${status} — [${run.name || run.path}](${run.html_url})\n`;
      }
      text += '\n';
    } catch (err) {
      text += `*${repo}*\n${describeError(err)}\n\n`;
    }
  }
  await ctx.reply(text, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  });
});

bot.command('last', async (ctx) => {
  let text = '🕐 *Последние 5 запусков тестов:*\n\n';
  for (const repo of REPOS) {
    try {
      const runs = await getRecentRuns(repo, 5);
      if (runs.length === 0) {
        text += `*${repo}* — нет запусков\n\n`;
        continue;
      }
      text += `*${repo}*\n`;
      runs.forEach((run, idx) => {
        const status = formatRunStatus(run.status, run.conclusion);
        const date = new Date(run.created_at).toLocaleString('ru-RU', {
          timeZone: 'Europe/Moscow',
        });
        text += `${idx + 1}. ${status} — ${date}\n   [${run.name || run.path}](${run.html_url})\n`;
      });
      text += '\n';
    } catch (err) {
      text += `*${repo}*\n${describeError(err)}\n\n`;
    }
  }
  await ctx.reply(text, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  });
});

bot.command('alerts', async (ctx) => {
  let text = '🚨 *Последние алерты (неудачные запуски):*\n\n';
  let found = false;
  for (const repo of REPOS) {
    try {
      const runs = await getRecentRuns(repo, 20);
      const failed = runs.filter(
        (r) => r.conclusion === 'failure' || r.conclusion === 'cancelled'
      );
      if (failed.length === 0) continue;
      found = true;
      text += `*${repo}*\n`;
      failed.slice(0, 5).forEach((run) => {
        const status = formatRunStatus(run.status, run.conclusion);
        const date = new Date(run.created_at).toLocaleString('ru-RU', {
          timeZone: 'Europe/Moscow',
        });
        text += `${status} — ${date}\n   [${run.name || run.path}](${run.html_url})\n`;
      });
      text += '\n';
    } catch (err) {
      text += `*${repo}*\n${describeError(err)}\n\n`;
    }
  }
  if (!found) {
    text += '✅ Неудачных запусков не найдено!';
  }
  await ctx.reply(text, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  });
});

bot.command('report', async (ctx) => {
  const lines = [
    '📊 *Ссылки на Allure-отчёты:*\n',
    `🔗 Основной отчёт: ${REPORT_BASE_URL}`,
  ];
  // Дополнительные подстраницы для типовой структуры postman-api-tests
  if (!REPORT_BASE_URL.endsWith('/')) {
    lines.push(`🔗 Playwright: ${REPORT_BASE_URL}/playwright/`);
  } else {
    lines.push(`🔗 Playwright: ${REPORT_BASE_URL}playwright/`);
  }
  // Ссылка на Pages-сайт репозитория (если доступен)
  for (const repo of REPOS) {
    const [owner, name] = repo.split('/');
    lines.push(`\n📦 [${repo} — Pages](https://${owner}.github.io/${name}/)`);
  }
  await ctx.reply(lines.join('\n'), {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  });
});

bot.command('run', async (ctx) => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  const workflowName = args[0] || DEFAULT_WORKFLOW;
  const ref = args[1] || DEFAULT_BRANCH;
  const repo = REPOS[0];

  await ctx.reply(`🚀 Запускаю workflow *${workflowName}* (ветка: ${ref}) в ${repo}...`, {
    parse_mode: 'Markdown',
  });

  try {
    // Сначала ищем ID workflow по имени файла
    let workflowId = null;
    const workflows = await getWorkflows(repo);
    const wf = workflows.find(
      (w) => w.path === `.github/workflows/${workflowName}` || w.name === workflowName
    );
    if (wf) {
      workflowId = wf.id;
    } else {
      // Если не нашли по имени файла, пробуем как ID
      workflowId = workflowName;
    }

    await github.post(
      `/repos/${repo}/actions/workflows/${workflowId}/dispatches`,
      { ref }
    );

    await ctx.reply(
      `✅ Workflow *${workflowName}* запущен!\n` +
        `Отслеживайте статус: https://github.com/${repo}/actions`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    await ctx.reply(`❌ Не удалось запустить workflow:\n${describeError(err)}`);
  }
});

// ──────────────────────────────────────────────────────────────
//  Обработка остальных сообщений
// ──────────────────────────────────────────────────────────────
bot.on('message:text', async (ctx) => {
  await ctx.reply(
    'Я не понимаю это сообщение. Используйте /help для списка команд.'
  );
});

// Глобальный обработчик ошибок
bot.catch((err) => {
  console.error('Глобальная ошибка бота:', err.error);
});

// ──────────────────────────────────────────────────────────────
//  Запуск — long polling
// ──────────────────────────────────────────────────────────────
async function main() {
  console.log('🤖 Запуск Telegram Alert Bot (long polling)...');
  console.log(`📂 Отслеживаемые репозитории: ${REPOS.join(', ')}`);
  console.log(`🔧 Workflow по умолчанию: ${DEFAULT_WORKFLOW} (${DEFAULT_BRANCH})`);
  if (ALLOWED_USER_ID) {
    console.log(`🔒 Доступ ограничен пользователем ID: ${ALLOWED_USER_ID}`);
  }

  // Удаляем webhook (на случай если был установлен ранее) и стартуем polling
  await bot.api.deleteWebhook({ drop_pending_updates: true });
  await bot.start({
    onStart: (botInfo) => {
      console.log(`✅ Бот @${botInfo.username} запущен и готов к работе!`);
    },
  });
}

main().catch((err) => {
  console.error('💥 Критическая ошибка при запуске:', err);
  process.exit(1);
});