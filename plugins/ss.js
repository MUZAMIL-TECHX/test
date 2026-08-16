const { cmd } = require('../arslan');
const axios = require('axios');

cmd({
  pattern: "screenshot",
  alias: ["ss", "webshot", "sitepic"],
  react: "🖥️",
  category: "tools",
  desc: "Take full HD desktop screenshot of a website",
  filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
  try {
    if (!q) {
      return reply(
        `╭━━━《 🖥️ *SCREENSHOT TOOL* 》━━━┈⊷
┃
┃ ✦ *Usage:* 
┃ ✦ .screenshot <website URL>
┃
┃ ✦ *Example:*
┃ ✦ .screenshot https://google.com
┃
┃ ✦ *Features:*
┃ ✦ 📸 Full HD (1280x720)
┃ ✦ 📄 Full page capture
┃ ✦ ⚡ Fast processing
┃
╰━━━━━━━━━━━━┈⊷`
      );
    }

    // Show processing
    await conn.sendMessage(from, {
      react: { text: "⏳", key: m.key }
    });

    await reply(`╭━━━《 🖥️ *CAPTURING SCREENSHOT* 》━━━┈⊷
┃
┃ ✦ *Website* : ${q}
┃ ✦ *Status*  : ⏳ *Processing...*
┃ ✦ *Quality* : 📸 *Full HD*
┃
╰━━━━━━━━━━━━┈⊷`);

    // ✅ API call for full HD screenshot (1280x720)
    const apiUrl = `https://movanest.xyz/v2/ssweb?url=${encodeURIComponent(q)}&width=1280&height=720&full_page=true`;
    const res = await axios.get(apiUrl, { timeout: 60000 });

    if (!res.data || !res.data.status || !res.data.screenshot) {
      await conn.sendMessage(from, {
        react: { text: "❌", key: m.key }
      });
      return reply(`╭━━━《 ❌ *SCREENSHOT FAILED* 》━━━┈⊷
┃
┃ ✦ *Error* : No response from API
┃ ✦ *Status* : ❌ *Failed*
┃
╰━━━━━━━━━━━━┈⊷`);
    }

    const screenshotUrl = res.data.screenshot;

    // ✅ Send screenshot with stylish caption
    await conn.sendMessage(from, {
      image: { url: screenshotUrl },
      caption: `╭━━━《 🖥️ *SCREENSHOT READY* 》━━━┈⊷
┃
┃ ✦ *Website* : ${q}
┃ ✦ *Quality* : 📸 *Full HD*
┃ ✦ *Size*    : 📐 *1280x720*
┃ ✦ *Mode*    : 📄 *Full Page*
┃ ✦ *Bot*     : 👑 *MUZAMIL-XD*
┃
╰━━━━━━━━━━━━┈⊷`
    }, { quoted: mek });

    await conn.sendMessage(from, {
      react: { text: "✅", key: m.key }
    });

  } catch (err) {
    console.error("SCREENSHOT COMMAND ERROR:", err.message);
    await conn.sendMessage(from, {
      react: { text: "❌", key: m.key }
    });
    reply(`╭━━━《 ❌ *SCREENSHOT ERROR* 》━━━┈⊷
┃
┃ ✦ *Error* : ${err.message}
┃ ✦ *Status* : ❌ *Failed*
┃ ✦ *Tip* : Try again later
┃
╰━━━━━━━━━━━━┈⊷`);
  }
});