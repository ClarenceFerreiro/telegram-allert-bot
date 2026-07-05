/**
 * Telegram Alert Bot
 * ------------------
 * Мониторинг и управление GitHub Actions через Telegram.
 * Работает в режиме long polling (grammY) — публичный URL не требуется.
 */

const { Bot, InlineKeyboard } = require('grammy');
const axios = require('axios');
const { NodeSSH } = require('node-ssh');

// ─── Конфигурация ───
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GITHUB_TOKEN = process.env.PAT_TOKEN;
const ALLOWED_USER_ID = process.env.TELEGRAM_USER_ID
  ? Number(process.env.TELEGRAM_USER_ID)
  : null;

const REPOS = (process.env.GITHUB_REPOS || process.env.REPOS || 'ClarenceFerreiro/postman-api-tests')
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

// VPS monitoring
const VPS_HOST = process.env.VPS_HOST || '188.255.163.132';
const VPS_USER = process.env.VPS_USER || 'root';
const VPS_SSH_KEY_BASE64 = process.env.VPS_SSH_KEY_BASE64 || '';

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
    .text('❓ Помощь', 'btn_help')
    .row()
    .text('🖥 VPS', 'btn_vps');
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

function vpsMenuKeyboard() {
  return new InlineKeyboard()
    .text('📊 Ресурсы', 'btn_vps_resources')
    .text('🐳 Docker', 'btn_vps_docker')
    .row()
    .text('📜 Логи', 'btn_vps_logs')
    .text('⏱ Uptime', 'btn_vps_uptime')
    .row()
    .text('🔄 Рестарт сервиса', 'btn_vps_restart_menu')
    .row()
    .text('⬅️ В меню', 'btn_menu');
}

function vpsRestartMenuKeyboard() {
  return new InlineKeyboard()
    .text('🌐 Nginx', 'btn_vps_restart_nginx')
    .text('🐳 Docker', 'btn_vps_restart_docker')
    .row()
    .text('🔄 Syncthing', 'btn_vps_restart_syncthing')
    .row()
    .text('⬅️ Назад к VPS', 'btn_vps_menu');
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
      '/sites — проверка доступности сайтов\n' +
      '/vps — меню управления VPS\n' +
      '  /vps resources — ресурсы VPS\n' +
      '  /vps docker — Docker контейнеры\n' +
      '  /vps uptime — uptime VPS\n' +
      '  /vps logs — последние логи\n\n' +
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

// ─── VPS helpers ───

function parseKeyValue(output) {
  const map = {};
  for (const line of output.trim().split('\n')) {
    const idx = line.indexOf('=');
    if (idx > 0) {
      map[line.slice(0, idx)] = line.slice(idx + 1);
    }
  }
  return map;
}

function serviceIcon(status) {
  return status === 'active' ? '✅' : '❌';
}

async function withVpsShell(fn) {
  // If an SSH key is provided, connect to the remote VPS.
  // Otherwise run commands locally — useful when the bot is deployed on the VPS itself.
  if (VPS_SSH_KEY_BASE64) {
    const ssh = new NodeSSH();
    try {
      const privateKey = Buffer.from(VPS_SSH_KEY_BASE64, 'base64').toString('utf-8');
      await ssh.connect({
        host: VPS_HOST,
        username: VPS_USER,
        privateKey,
        readyTimeout: 15000,
      });
      return await fn(ssh);
    } finally {
      ssh.dispose();
    }
  }

  // Local fallback: emulate the ssh.execCommand interface.
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  const localShell = {
    execCommand: async (command) => {
      try {
        const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
        return { stdout: stdout || '', stderr: stderr || '', code: 0 };
      } catch (err) {
        return {
          stdout: err.stdout || '',
          stderr: err.stderr || '',
          code: err.code || 1,
        };
      }
    },
  };

  return await fn(localShell);
}

// Convenience: collect a single command output, respecting remote vs local.
async function vpsExec(command) {
  const result = await withVpsShell((shell) => shell.execCommand(command));
  return result;
}

async function handleVpsMenu(ctx) {
  await ctx.reply(
    `🖥 *VPS ${VPS_HOST}*\n\nВыберите действие:`,
    {
      parse_mode: 'Markdown',
      reply_markup: vpsMenuKeyboard(),
    }
  );
}

async function handleVpsHealth(ctx) {
  await ctx.reply('🖥 *Запрашиваю состояние ресурсов...*', { parse_mode: 'Markdown' });

  try {
    const result = await vpsExec(`
      set -e
      HOST=\$(hostname)
      UPTIME=\$(uptime -p 2>/dev/null || uptime | sed 's/.*up /up /' | sed 's/,.*//')
      LOAD=\$(cat /proc/loadavg | awk '{print \$1, \$2, \$3}')
      RAM_USED=\$(free -m | awk '/Mem:/{print \$3}')
      RAM_TOTAL=\$(free -m | awk '/Mem:/{print \$2}')
      DISK_PCT=\$(df -h / | awk 'NR==2{print \$5}')
      DISK_FREE=\$(df -h / | awk 'NR==2{print \$4}')
      DOCKER_COUNT=\$(docker ps -q 2>/dev/null | wc -l)
      NGINX=\$(systemctl is-active nginx 2>/dev/null || echo inactive)
      DOCKER_SVC=\$(systemctl is-active docker 2>/dev/null || echo inactive)
      SYNCTHING=\$(systemctl is-active syncthing 2>/dev/null || echo inactive)
      echo "HOST=\$HOST"
      echo "UPTIME=\$UPTIME"
      echo "LOAD=\$LOAD"
      echo "RAM_USED=\$RAM_USED"
      echo "RAM_TOTAL=\$RAM_TOTAL"
      echo "DISK_PCT=\$DISK_PCT"
      echo "DISK_FREE=\$DISK_FREE"
      echo "DOCKER_COUNT=\$DOCKER_COUNT"
      echo "NGINX=\$NGINX"
      echo "DOCKER_SVC=\$DOCKER_SVC"
      echo "SYNCTHING=\$SYNCTHING"
    `);

    if (result.stderr) {
      console.error('VPS health stderr:', result.stderr);
    }

    const m = parseKeyValue(result.stdout);
    const ramPct = m.RAM_TOTAL > 0
      ? Math.round((Number(m.RAM_USED) / Number(m.RAM_TOTAL)) * 100)
      : '?';

    const status = [];
    const diskValue = parseInt((m.DISK_PCT || '').replace('%', ''), 10) || 0;
    if (diskValue >= 90) status.push('⚠️ Диск заполнен более чем на 90%');
    if (ramPct >= 80) status.push('⚠️ RAM используется более чем на 80%');
    if (m.NGINX !== 'active' || m.DOCKER_SVC !== 'active' || m.SYNCTHING !== 'active') {
      status.push('🚨 Один или несколько сервисов не активны');
    }
    if (status.length === 0) status.push('✅ Всё в порядке');

    const lines = [
      `🖥 *Состояние VPS (${VPS_HOST})*`,
      `Host: ${m.HOST || '—'}`,
      `Uptime: ${m.UPTIME || '—'}`,
      '',
      '*📊 Ресурсы*',
      `• Load: ${m.LOAD || '—'}`,
      `• RAM: ${m.RAM_USED || '—'} / ${m.RAM_TOTAL || '—'} MB (~${ramPct}%)`,
      `• Disk: ${m.DISK_PCT || '—'} (${m.DISK_FREE || '—'} free)`,
      '',
      '*🔧 Сервисы*',
      `${serviceIcon(m.NGINX)} nginx — ${m.NGINX || '—'}`,
      `${serviceIcon(m.DOCKER_SVC)} docker — ${m.DOCKER_SVC || '—'}`,
      `${serviceIcon(m.SYNCTHING)} syncthing — ${m.SYNCTHING || '—'}`,
      '',
      `*🐳 Docker контейнеров:* ${m.DOCKER_COUNT || '—'}`,
      '',
      `*Статус:* ${status.join(' / ')}`,
    ];

    await ctx.reply(lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: vpsMenuKeyboard(),
    });
  } catch (err) {
    console.error('VPS health error:', err);
    await ctx.reply(
      `❌ Не удалось получить состояние VPS:\n${err.message || 'Unknown error'}`,
      { reply_markup: vpsMenuKeyboard() }
    );
  }
}

async function handleVpsDocker(ctx) {
  await ctx.reply('🐳 *Запрашиваю список контейнеров...*', { parse_mode: 'Markdown' });

  try {
    const result = await vpsExec(
      "docker ps --format '{{.Names}} | {{.Image}} | {{.Status}}' 2>/dev/null || echo 'No containers running'"
    );

    const containers = result.stdout.trim() || 'Нет запущенных контейнеров';
    const text = [
      `🐳 *Docker контейнеры (${VPS_HOST})*`,
      '',
      '\`\`\`',
      containers,
      '\`\`\`',
    ].join('\n');

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      reply_markup: vpsMenuKeyboard(),
    });
  } catch (err) {
    console.error('VPS docker error:', err);
    await ctx.reply(
      `❌ Не удалось получить список контейнеров:\n${err.message || 'Unknown error'}`,
      { reply_markup: vpsMenuKeyboard() }
    );
  }
}

async function handleVpsUptime(ctx) {
  try {
    const result = await vpsExec("uptime -p 2>/dev/null || uptime | sed 's/.*up /up /' | sed 's/,.*//'");
    const uptime = result.stdout.trim() || '—';
    await ctx.reply(
      `⏱ *Uptime ${VPS_HOST}*\n\n${uptime}`,
      { parse_mode: 'Markdown', reply_markup: vpsMenuKeyboard() }
    );
  } catch (err) {
    console.error('VPS uptime error:', err);
    await ctx.reply(
      `❌ Не удалось получить uptime:\n${err.message || 'Unknown error'}`,
      { reply_markup: vpsMenuKeyboard() }
    );
  }
}

async function handleVpsLogs(ctx) {
  await ctx.reply('📜 *Запрашиваю последние логи...*', { parse_mode: 'Markdown' });

  try {
    const result = await vpsExec(
      'echo "=== nginx ===" && journalctl -u nginx --no-pager -n 20 2>/dev/null && ' +
        'echo "" && echo "=== docker ===" && journalctl -u docker --no-pager -n 20 2>/dev/null'
    );

    const logs = result.stdout.trim() || 'Логи не найдены';
    const trimmed = logs.length > 3800 ? logs.slice(0, 3800) + '\n\n... (обрезано)' : logs;

    await ctx.reply(
      `📜 *Логи (${VPS_HOST})*\n\n\`\`\`\n${trimmed}\n\`\`\``,
      { parse_mode: 'Markdown', reply_markup: vpsMenuKeyboard() }
    );
  } catch (err) {
    console.error('VPS logs error:', err);
    await ctx.reply(
      `❌ Не удалось получить логи:\n${err.message || 'Unknown error'}`,
      { reply_markup: vpsMenuKeyboard() }
    );
  }
}

async function handleVpsRestart(ctx, service) {
  const serviceNames = {
    nginx: 'nginx',
    docker: 'docker',
    syncthing: 'syncthing',
  };
  const name = serviceNames[service] || service;

  await ctx.reply(
    `🔄 *Рестарт ${name} на ${VPS_HOST}...*`,
    { parse_mode: 'Markdown' }
  );

  try {
    const result = await vpsExec(`systemctl restart ${name} && systemctl is-active ${name}`);

    const status = result.stdout.trim();
    const ok = status === 'active';

    await ctx.reply(
      `${ok ? '✅' : '⚠️'} *Рестарт ${name}*\n\n` +
        `${ok ? 'Сервис успешно перезапущен.' : 'Рестарт выполнен, но статус сервиса неактивен.'}\n` +
        `Текущий статус: ${status || '—'}`,
      { parse_mode: 'Markdown', reply_markup: vpsMenuKeyboard() }
    );
  } catch (err) {
    console.error('VPS restart error:', err);
    await ctx.reply(
      `❌ Не удалось перезапустить ${name}:\n${err.message || 'Unknown error'}`,
      { reply_markup: vpsRestartMenuKeyboard() }
    );
  }
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

bot.command('vps', async (ctx) => {
  const args = ctx.message.text.split(/\s+/).slice(1);
  const sub = args[0]?.toLowerCase();
  if (sub === 'resources' || sub === 'ресурсы') return handleVpsHealth(ctx);
  if (sub === 'docker') return handleVpsDocker(ctx);
  if (sub === 'uptime') return handleVpsUptime(ctx);
  if (sub === 'logs') return handleVpsLogs(ctx);
  return handleVpsMenu(ctx);
});

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

bot.callbackQuery('btn_vps', async (ctx) => {
  await ctx.answerCallbackQuery('Открываю меню VPS...');
  await handleVpsMenu(ctx);
});

bot.callbackQuery('btn_vps_menu', async (ctx) => {
  await ctx.answerCallbackQuery();
  await handleVpsMenu(ctx);
});

bot.callbackQuery('btn_vps_resources', async (ctx) => {
  await ctx.answerCallbackQuery('Запрашиваю ресурсы...');
  await handleVpsHealth(ctx);
});

bot.callbackQuery('btn_vps_docker', async (ctx) => {
  await ctx.answerCallbackQuery('Запрашиваю Docker...');
  await handleVpsDocker(ctx);
});

bot.callbackQuery('btn_vps_logs', async (ctx) => {
  await ctx.answerCallbackQuery('Запрашиваю логи...');
  await handleVpsLogs(ctx);
});

bot.callbackQuery('btn_vps_uptime', async (ctx) => {
  await ctx.answerCallbackQuery('Запрашиваю uptime...');
  await handleVpsUptime(ctx);
});

bot.callbackQuery('btn_vps_restart_menu', async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply('🔄 *Выберите сервис для рестарта:*', {
    parse_mode: 'Markdown',
    reply_markup: vpsRestartMenuKeyboard(),
  });
});

bot.callbackQuery('btn_vps_restart_nginx', async (ctx) => {
  await ctx.answerCallbackQuery('Рестарт nginx...');
  await handleVpsRestart(ctx, 'nginx');
});

bot.callbackQuery('btn_vps_restart_docker', async (ctx) => {
  await ctx.answerCallbackQuery('Рестарт docker...');
  await handleVpsRestart(ctx, 'docker');
});

bot.callbackQuery('btn_vps_restart_syncthing', async (ctx) => {
  await ctx.answerCallbackQuery('Рестарт syncthing...');
  await handleVpsRestart(ctx, 'syncthing');
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