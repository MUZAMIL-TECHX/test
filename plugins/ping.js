const { cmd } = require('../arslan');
const { sleep } = require('../lib/functions');

cmd({
  pattern: "ping",
  desc: "Live ping speed monitor",
  category: "main",
  react: "🚀",
  filename: __filename
}, async (conn, mek, m, { from, reply }) => {

  try {

    // start reaction
    await conn.sendMessage(from, {
      react: { text: "🚀", key: m.key }
    });

    // initial message
    const msg = await conn.sendMessage(from, {
      text: `╭━━━《 🚀 *PING TEST* 》━━━┈⊷
┃
┃ ✦ *Status* : 🔄 *Testing...*
┃
╰━━━━━━━━━━━━┈⊷`
    }, { quoted: mek });

    await sleep(1000);

    // 🔁 live update loop (5 seconds)
    for (let i = 0; i < 5; i++) {

      const start = Date.now();
      await sleep(50);
      const ping = Date.now() - start;
      
      // Speed emoji
      let speedEmoji = "🐢";
      if (ping < 50) speedEmoji = "⚡";
      else if (ping < 100) speedEmoji = "🚀";
      else if (ping < 200) speedEmoji = "📶";
      else if (ping < 500) speedEmoji = "📡";

      await conn.relayMessage(from, {
        protocolMessage: {
          key: msg.key,
          type: 14,
          editedMessage: {
            conversation: `╭━━━《 🚀 *PING TEST* 》━━━┈⊷
┃
┃ ✦ *Speed*  : *${ping}ms* ${speedEmoji}
┃ ✦ *Time*   : ⏱️ ${i+1}/5s
┃
╰━━━━━━━━━━━━┈⊷`
          }
        }
      }, {});

      await sleep(1000);
    }

    // Final message
    await conn.relayMessage(from, {
      protocolMessage: {
        key: msg.key,
        type: 14,
        editedMessage: {
          conversation: `╭━━━《 ✅ *PING DONE* 》━━━┈⊷
┃
┃ ✦ *Status* : ✅ *Complete*
┃ ✦ *Bot*    : 👑 *MUZAMIL-XD*
┃
╰━━━━━━━━━━━━┈⊷`
        }
      }
    }, {});

    // end reaction
    await conn.sendMessage(from, {
      react: { text: "✅", key: m.key }
    });

  } catch (e) {

    console.error("Ping Error:", e);

    await conn.sendMessage(from, {
      react: { text: "❌", key: m.key }
    });

    reply(`╭━━━《 ❌ *PING ERROR* 》━━━┈⊷
┃
┃ ✦ *Error* : ${e.message}
┃
╰━━━━━━━━━━━━┈⊷`);
  }
});
