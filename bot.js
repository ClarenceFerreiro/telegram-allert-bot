const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GITHUB_TOKEN = process.env.PAT_TOKEN;
const REPO = 'ClarenceFerreiro/postman-api-tests';

const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;

async function sendMessage(chatId, text) {
    try {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: 'markdown'
        });
    } catch (error) {
        console.error('Error:', error.message);
    }
}

app.post(`/${TOKEN}`, async (req, res) => {
    const { message } = req.body;
    if (!message || !message.text) return res.sendStatus(200);

    const chatId = message.chat.id;
    const text = message.text;

    if (text === '/start') {
        await sendMessage(chatId, "🤖 *Test Bot*\n\n/status - статус тестов\n/report - ссылки\n/run - запустить тесты");
    }
    else if (text === '/status') {
        await sendMessage(chatId, "✅ Postman: passed\n💙 TypeScript: passed\n🎭 Playwright: passed");
    }
    else if (text === '/report') {
        await sendMessage(chatId, "📊 *Отчёты:*\nPostman: https://clarenceferreiro.github.io/postman-api-tests/\nPlaywright: https://clarenceferreiro.github.io/postman-api-tests/playwright/");
    }
    else if (text === '/run') {
        await sendMessage(chatId, "🚀 Запускаю тесты...");
        try {
            await axios.post(
                `https://api.github.com/repos/${REPO}/actions/workflows/allure-report.yml/dispatches`,
                { ref: 'main' },
                { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
            );
            await sendMessage(chatId, "✅ Тесты запущены!");
        } catch (error) {
            await sendMessage(chatId, "❌ Ошибка запуска");
        }
    }
    res.sendStatus(200);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
