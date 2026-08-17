const { cmd } = require('../arslan');
const axios = require('axios');

cmd({
    pattern: "ai",
    alias: ["darkai", "workai", "ask", "chatgpt", "gpt", "aiask"],
    react: "🤖",
    desc: "AI Chat assistant powered by WormGPT",
    category: "ai",
    use: ".ai <your question>",
    filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
    try {
        if (!q) {
            return reply(
                `╔═══════════════════════════════════╗
║     🤖 *AI CHAT ASSISTANT* 🤖     ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Command Usage:*              ║
║  ✦ .ai <your question>           ║
║  ✦ .darkai <your question>       ║
║  ✦ .workai <your question>       ║
║  ✦ .ask <your question>          ║
║                                   ║
║  ✦ *Examples:*                   ║
║  ✦ .ai What is AI?               ║
║  ✦ .darkai Who are you?          ║
║  ✦ .workai Help me with code     ║
║  ✦ .ask What is love?            ║
║                                   ║
║  ✦ *Features:*                   ║
║  ✦ 🧠 Smart AI responses         ║
║  ✦ ⚡ Fast processing             ║
║  ✦ 🌐 24/7 Available             ║
║  ✦ 🎯 Accurate answers           ║
║                                   ║
╚═══════════════════════════════════╝`
            );
        }

        // Show processing
        await conn.sendMessage(from, {
            react: { text: "⏳", key: m.key }
        });

        await reply(
            `╔═══════════════════════════════════╗
║     🧠 *PROCESSING REQUEST* 🧠   ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Question* : ${q.substring(0, 30)}${q.length > 30 ? "..." : ""}
║  ✦ *Status* : ⏳ *Thinking*      ║
║  ✦ *Mode*   : 🤖 *AI Assistant*  ║
║                                   ║
╚═══════════════════════════════════╝`
        );

        // API Call
        const apiUrl = `https://wormgpt.freeapihub.workers.dev/chat?q=${encodeURIComponent(q)}`;
        const response = await axios.get(apiUrl, { 
            timeout: 60000,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            }
        });

        const data = response.data;

        // Handle different response formats
        let answer = "";
        if (data && typeof data === 'object') {
            if (data.answer) {
                answer = data.answer;
            } else if (data.response) {
                answer = data.response;
            } else if (data.result) {
                answer = data.result;
            } else if (data.message) {
                answer = data.message;
            } else if (data.text) {
                answer = data.text;
            } else {
                answer = JSON.stringify(data);
            }
        } else if (typeof data === 'string') {
            answer = data;
        } else {
            answer = "No response received from AI.";
        }

        if (!answer || answer.length < 2) {
            await conn.sendMessage(from, {
                react: { text: "❌", key: m.key }
            });
            return reply(
                `╔═══════════════════════════════════╗
║     ❌ *NO RESPONSE* ❌         ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Question* : ${q.substring(0, 30)}${q.length > 30 ? "..." : ""}
║  ✦ *Status* : ❌ *Failed*       ║
║                                   ║
║  ═══════════════════════════════  ║
║  💡 *Tips:*                       ║
║  ✦ Try asking differently        ║
║  ✦ Use shorter questions         ║
║  ✦ Try again in a moment         ║
║  ✦ Check your internet           ║
║                                   ║
╚═══════════════════════════════════╝`
            );
        }

        // Format the response with new style
        const formattedAnswer = answer.length > 1000 ? answer.substring(0, 1000) + "\n\n...(truncated)" : answer;

        const responseText = 
`*_MUZAMIL-XD_*
${formattedAnswer}
> Powered By MUZAMIL-XD`;

        // Send response
        await conn.sendMessage(from, {
            text: responseText
        }, { quoted: mek });

        await conn.sendMessage(from, {
            react: { text: "✅", key: m.key }
        });

    } catch (e) {
        console.error("AI COMMAND ERROR:", e);
        await conn.sendMessage(from, {
            react: { text: "❌", key: m.key }
        });
        
        let errorMessage = e.message || "Unknown error";
        if (e.code === 'ECONNABORTED') {
            errorMessage = "Request timeout - API taking too long";
        } else if (e.response?.status === 400) {
            errorMessage = "Invalid request - try a different question";
        } else if (e.response?.status === 429) {
            errorMessage = "Rate limit exceeded - try again later";
        } else if (e.response?.status === 500) {
            errorMessage = "Server error - try again later";
        }

        reply(
            `╔═══════════════════════════════════╗
║     ❌ *AI SYSTEM ERROR* ❌     ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Error* : ${errorMessage}       ║
║  ✦ *Status* : 🔴 *Offline*       ║
║                                   ║
║  ═══════════════════════════════  ║
║  💡 *Solutions:*                  ║
║  ✦ Check your internet           ║
║  ✦ Try again in 5 minutes        ║
║  ✦ Use different wording         ║
║  ✦ Try shorter questions         ║
║  ✦ Use .ai for general chat      ║
║                                   ║
╚═══════════════════════════════════╝`
        );
    }
});