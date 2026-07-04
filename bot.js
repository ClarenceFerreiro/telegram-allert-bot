/**
 * Telegram Alert Bot
 * ------------------
 * Мониторинг и управление GitHub Actions через Telegram.
 * Работает в режиме long polling (grammY) — публичный URL не требуется.
 */

const { Bot, InlineKeyboard } = require('grammy');
const axios = require('axios');

// ─── Конфигурация ───
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GITHUB_TOKEN = process.env.PAT_TOKEN;
const ALLOWED_USER_ID = process.env.TELEGRAM_USER_ID
  ? Number(process.env.TELEGRAM_USER_ID)
  : null;

const REPOS = (process.env.GITHUB_REPOS || 'ClarenceFerreiro/postman-api-tests')
  .split(',')
  .map((r) => r.trim())
  .filter(Boolean);

const DEFAULT_WORKFLOW = process.env.DEFAULT_WORKFLOW || 'allure-report.yml';
const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH || 'main';
const REPORT_BASE_URL = process.env.REPORT_BASE_URL || 'https://clarenceferreiro.github.io/postman-api-tests/';

// Сайты для мониторинга (through env var SITES or default)
const SITES = (process.env.SITES || 'https://babycloud.by/,https://premiumfuji.by/,http://188.255.163.132/')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!TELEGRAM_BOT_TOKEN) { console.error('❌ TELEGRAM_BOT_TOKEN not set'); process.exit(1); }
if (!GITHUB_TOKEN) { console.error('❌ PAT_TOKEN not set'); process.exit(1); }

// ─── GitHub API client ───
const github = axios.create({
  baseURL: 'https://api.github.com',
  timeout: 15000,
  headers: {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  },
});

const bot = new Bot(TELEGRAM_BOT_TOKEN);

// Access control
bot.use((ctx, next) => {
  if (ALLOWED_USER_ID !== null && ctx.from?.id !== ALLOWED_USER_ID) {
    console.warn(`🚫 Access denied for user ${ctx.from?.id} (${ctx.from?.username || 'unknown'})`);
    return ctx.reply('🚫 У вас нет доступа к этому боту.');
  }
  return next();
});

// ─── Inline-клавиатуры (меню-кнопки) ───

function mainMenuKeyboard() {
  return new InlineKeyboard()
    .text('📊 Статус', 'btn_status')
    .text('🕐 Последние', 'btn_last')
    .row()
    .text('🚨 Алерты', 'btn_alerts')
    .text('🚀 Запустить', 'btn_run')
    .row()
    .text('📊 Отчёты', 'btn_report')
    .text('📂 Репозитории', 'btn_repos')
    .row()
    .text('🌐 Сайты', 'btn_sites')
    .text('❓ Помощь', 'btn_help');
}

function backKeyboard() {
  return new InlineKeyboard()
    .text('⬅️ В меню', 'btn_menu');
}

function runKeyboard() {
  return new InlineKeyboard()
    .text('🚀 Allure Report', 'btn_run_allure')
    .text('📝 TypeScript Tests', 'btn_run_ts')
    .row()
    .text('⬅️ В меню', 'btn_menu');
}

// ─── Вспомогательные функции ───

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

async function getRecentRuns(repo, perPage = 5) {
  const { data } = await github.get(`/repos/${repo}/actions/runs`, {
    params: { per_page: perPage, page: 1 },
  });
  return data.workflow_runs || [];
}

async function getWorkflows(repo) {
  const { data } = await github.get(`/repos/${repo}/actions/workflows`);
  return data.workflows || [];
}

function describeError(err) {
  if (err.response) {
    const gh = err.response.data;
    const msg = gh?.message || gh?.error || `GitHub API: ${err.response.status}`;
    return `❌ ${msg}`;
  }
  return `❌ ${err.message || 'Unknown error'}`;
}

// ─── Обработчики (команды + кнопки) ───

async function handleStatus(ctx) {
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
    reply_markup: backKeyboard(),
  });
}

async function handleLast(ctx) {
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
    reply_markup: backKeyboard(),
  });
}

async function handleAlerts(ctx) {
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
    reply_markup: backKeyboard(),
  });
}

async function handleReport(ctx) {
  const lines = [
    '📊 *Ссылки на Allure-отчёты:*\n',
    `🔗 Основной отчёт: ${REPORT_BASE_URL}`,
  ];
  if (!REPORT_BASE_URL.endsWith('/')) {
    lines.push(`🔗 TypeScript: ${REPORT_BASE_URL}/allure-ts/`);
  } else {
    lines.push(`🔗 TypeScript: ${REPORT_BASE_URL}allure-ts/`);
  }
  for (const repo of REPOS) {
    const [owner, name] = repo.split('/');
    lines.push(`\n📦 [${repo} — Pages](https://${owner}.github.io/${name}/)`);
  }
  await ctx.reply(lines.join('\n'), {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    reply_markup: backKeyboard(),
  });
}

async function handleRepos(ctx) {
  const lines = REPOS.map((r, i) => `${i + 1}. [${r}](https://github.com/${r})`).join('\n');
  await ctx.reply(`📂 *Отслеживаемые репозитории:*\n\n${lines}`, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    reply_markup: backKeyboard(),
  });
}

async function handleRun(ctx, workflowName) {
  const wf = workflowName || DEFAULT_WORKFLOW;
  const ref = DEFAULT_BRANCH;
  const repo = REPOS[0];

  await ctx.reply(`🚀 Запускаю workflow *${wf}* (ветка: ${ref}) в ${repo}...`, {
    parse_mode: 'Markdown',
  });

  try {
    let workflowId = null;
    const workflows = await getWorkflows(repo);
    const found = workflows.find(
      (w) => w.path === `.github/workflows/${wf}` || w.name === wf
    );
    workflowId = found ? found.id : wf;

    await github.post(
      `/repos/${repo}/actions/workflows/${workflowId}/dispatches`,
      { ref }
    );

    await ctx.reply(
      `✅ Workflow *${wf}* запущен!\n` +
        `Отслеживайте статус: https://github.com/${repo}/actions`,
      { parse_mode: 'Markdown', reply_markup: backKeyboard() }
    );
  } catch (err) {
    await ctx.reply(`❌ Не удалось запустить workflow:\n${describeError(err)}`, {
      reply_markup: backKeyboard(),
    });
  }
}

async function handleHelp(ctx) {
  await ctx.reply(
    '📋 *Команды бота:*\n\n' +
      '/start — приветствие + меню\n' +
      '/help — этот список команд\n' +
      '/status — статус последних GitHub Actions runs\n' +
      '/last — последние 5 запусков тестов\n' +
      '/alerts — последние неудачные запуски\n' +
      '/run — запуск workflow\n' +
      '/report — ссылки на Allure-отчёты\n' +
      '/repos — список отслеживаемых репозиториев\n' +
      '/sites — проверка доступности сайтов\n\n' +
      '💡 Или используйте кнопки меню ниже:',
    {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(),
    }
  );
}

// ─── Проверка сайтов ───

async function checkSite(url) {
  const start = Date.now();
  try {
    const resp = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: () => true, // не бросать ошибку на не-2xx
      // Для refgroup.by (VPS IP) — передаём Host header
      headers: url.includes('188.255.163.132') ? { Host: 'refgroup.by' } : {},
    });
    const elapsed = Date.now() - start;
    const status = resp.status;
    const ok = status >= 200 && status < 400;
    return {
      url,
      status,
      ok,
      elapsed,
      error: null,
    };
  } catch (err) {
    const elapsed = Date.now() - start;
    return {
      url,
      status: null,
      ok: false,
      elapsed,
      error: err.code || err.message || 'Connection failed',
    };
  }
}

function siteName(url) {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return url;
  }
}

async function handleSites(ctx) {
  let text = '🌐 *Проверка сайтов:*\n\n';
  let allOk = true;

  const results = await Promise.all(SITES.map((s) => checkSite(s)));

  for (const r of results) {
    const name = siteName(r.url);
    if (r.ok) {
      text += `✅ *${name}* — ${r.status} (${r.elapsed}ms)\n`;
    } else {
      allOk = false;
      if (r.status) {
        text += `❌ *${name}* — ${r.status} (${r.elapsed}ms)\n`;
      } else {
        text += `❌ *${name}* — ${r.error} (${r.elapsed}ms)\n`;
      }
    }
  }

  text += '\n';
  if (allOk) {
    text += '✅ Все сайты доступны!';
  } else {
    text += '🚨 Есть проблемы с доступностью!';
  }

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    reply_markup: backKeyboard(),
  });
}

// ─── Команды ───

bot.command('start', async (ctx) => {
  await ctx.reply(
    '🤖 *Telegram Alert Bot*\n\n' +
      'Бот для мониторинга и управления GitHub Actions.\n' +
      'Используйте кнопки ниже для управления:\n\n' +
      '📊 — статус тестов\n' +
      '🕐 — последние запуски\n' +
      '🚨 — алерты и ошибки\n' +
      '🚀 — запуск тестов\n' +
      '📊 — ссылки на отчёты',
    {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard(),
    }
  );
});

bot.command('help', handleHelp);
bot.command('status', handleStatus);
bot.command('last', handleLast);
bot.command('alerts', handleAlerts);
bot.command('report', handleReport);
bot.command('repos', handleRepos);
bot.command('sites', handleSites);

bot.command('run', async (ctx) => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  await handleRun(ctx, args[0]);
});

// ─── Callback query handler (нажатия на inline-кнопки) ───

bot.callbackQuery('btn_menu', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply('🏠 *Главное меню*', {
    parse_mode: 'Markdown',
    reply_markup: mainMenuKeyboard(),
  });
});

bot.callbackQuery('btn_status', async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleStatus(ctx);
});

bot.callbackQuery('btn_last', async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleLast(ctx);
});

bot.callbackQuery('btn_alerts', async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleAlerts(ctx);
});

bot.callbackQuery('btn_report', async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleReport(ctx);
});

bot.callbackQuery('btn_repos', async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleRepos(ctx);
});

bot.callbackQuery('btn_sites', async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleSites(ctx);
});

bot.callbackQuery('btn_help', async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleHelp(ctx);
});

bot.callbackQuery('btn_run', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply('🚀 *Выберите workflow для запуска:*', {
    parse_mode: 'Markdown',
    reply_markup: runKeyboard(),
  });
});

bot.callbackQuery('btn_run_allure', async (ctx) => {
  await ctx.answerCallbackQuery('Запускаю Allure Report...');
  await handleRun(ctx, 'allure-report.yml');
});

bot.callbackQuery('btn_run_ts', async (ctx) => {
  await ctx.answerCallbackQuery('Запускаю TypeScript Tests...');
  await handleRun(ctx, 'typescript-ci-v2.yml');
});

// ─── Обработка остальных сообщений ───
bot.on('message:text', async (ctx) => {
  await ctx.reply(
    'Я не понимаю это сообщение. Используйте /help или нажмите кнопку меню.',
    { reply_markup: mainMenuKeyboard() }
  );
});

bot.catch((err) => {
  console.error('Bot error:', err.error);
});

// ─── Запуск ───
async function main() {
  console.log('🤖 Starting Telegram Alert Bot (long polling)...');
  console.log(`📂 Repositories: ${REPOS.join(', ')}`);
  console.log(`🔧 Default workflow: ${DEFAULT_WORKFLOW} (${DEFAULT_BRANCH})`);
  if (ALLOWED_USER_ID) {
    console.log(`🔒 Access restricted to user ID: ${ALLOWED_USER_ID}`);
  }

  await bot.api.deleteWebhook({ drop_pending_updates: true });

  // Menu button — commands list in Telegram client
  await bot.api.setChatMenuButton({
    menu_button: { type: 'commands' },
  });

  // Bot description
  await bot.api.setMyDescription(
    'Бот для мониторинга и управления GitHub Actions. Статус тестов, запуск workflow, Allure-отчёты.'
  );

  await bot.api.setMyShortDescription(
    'QA Alert Bot — мониторинг GitHub Actions'
  );

  // Slash commands in Telegram client
  await bot.api.setMyCommands([
    { command: 'start', description: 'Приветствие + меню' },
    { command: 'help', description: 'Список команд' },
    { command: 'status', description: 'Статус GitHub Actions' },
    { command: 'last', description: 'Последние 5 запусков' },
    { command: 'alerts', description: 'Неудачные запуски' },
    { command: 'run', description: 'Запустить workflow' },
    { command: 'report', description: 'Ссылки на отчёты' },
    { command: 'repos', description: 'Отслеживаемые репозитории' },
    { command: 'sites', description: 'Проверка сайтов' },
  ]);

  await bot.start({
    onStart: (botInfo) => {
      console.log(`✅ Bot @${botInfo.username} started successfully!`);
      console.log(`📱 Inline keyboard and menu button configured.`);
    },
  });
}

main().catch((err) => {
  console.error('💥 Fatal error on startup:', err);
  process.exit(1);
});