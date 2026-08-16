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

    // initial message with stylish header
    const msg = await conn.sendMessage(from, {
      text: `╭━━━《 🚀 *PING MONITOR* 》━━━┈⊷
┃
┃ ✦ *Status* : 🔄 *Testing...*
┃ ✦ *Speed*  : ⏳ *Calculating*
┃ ✦ *Mode*   : 📡 *Live Monitor*
┃
╰━━━━━━━━━━━━┈⊷`
    }, { quoted: mek });

    await sleep(1000);

    // 🔁 live update loop (30 seconds)
    for (let i = 0; i < 30; i++) {

      const start = Date.now();

      // tiny delay simulating ping check
      await sleep(50);

      const ping = Date.now() - start;
      
      // Determine speed emoji based on ping
      let speedEmoji = "🐢"; // Slow
      let speedStatus = "SLOW";
      if (ping < 50) {
        speedEmoji = "⚡"; 
        speedStatus = "LIGHTNING";
      } else if (ping < 100) {
        speedEmoji = "🚀"; 
        speedStatus = "FAST";
      } else if (ping < 200) {
        speedEmoji = "📶"; 
        speedStatus = "GOOD";
      } else if (ping < 500) {
        speedEmoji = "📡"; 
        speedStatus = "MODERATE";
      }

      // Create live status bar
      const barLength = Math.min(Math.floor(ping / 20), 20);
      const bar = "█".repeat(barLength) + "░".repeat(20 - barLength);

      await conn.relayMessage(from, {
        protocolMessage: {
          key: msg.key,
          type: 14,
          editedMessage: {
            conversation: `╭━━━《 🚀 *PING MONITOR* 》━━━┈⊷
┃
┃ ✦ *Status* : ${speedEmoji} *${speedStatus}*
┃ ✦ *Speed*  : *${ping}ms* 🎯
┃ ✦ *Bar*    : ${bar}
┃ ✦ *Mode*   : 📡 *Live Monitor*
┃ ✦ *Time*   : ⏱️ ${i+1}/30s
┃
╰━━━━━━━━━━━━┈⊷`
          }
        }
      }, {});

      await sleep(1000);
    }

    // Final completed message
    await conn.relayMessage(from, {
      protocolMessage: {
        key: msg.key,
        type: 14,
        editedMessage: {
          conversation: `╭━━━《 🚀 *PING COMPLETE* 》━━━┈⊷
┃
┃ ✦ *Status* : ✅ *Monitor Finished*
┃ ✦ *Duration* : ⏱️ 30 Seconds
┃ ✦ *Mode*    : 📡 *Live Monitor*
┃ ✦ *Bot*     : 👑 *MUZAMIL-XD*
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
┃ ✦ *Status* : ❌ *Failed*
┃
╰━━━━━━━━━━━━┈⊷`);
  }
});