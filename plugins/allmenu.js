const { cmd } = require("../arslan");
const moment = require("moment-timezone");
const { fakevCard } = require('../lib/fakevCard');

cmd({
    pattern: "menu",
    alias: ["commandlist", "allmenu", "help"],
    desc: "Display all available bot commands",
    category: "system",
    filename: __filename,
}, async (conn, mek, m, { reply }) => {
    try {
        const time = moment().tz("Africa/Kampala").format("HH:mm:ss");
        const date = moment().tz("Africa/Kampala").format("dddd, MMMM Do YYYY");

        const menuText = `
╔══════════════════════════════════════════════════╗
║              ✦ 𝗠𝗨𝗭𝗔𝗠𝗜𝗟-𝗫𝗗 𝗕𝗢𝗧 ✦              ║
╠══════════════════════════════════════════════════╣
║                                                  ║
║   ⏱️ Time     : ${time}                           ║
║   📅 Date     : ${date}                          ║
║   📊 Commands : 64 Active                        ║
║   👑 Owner    : MUZAMIL-XD                      ║
║   🌐 Platform : TeamRedXhackers                  ║
║                                                  ║
╠══════════════════════════════════════════════════╣
║                                                  ║
║  🤖 𝗔𝗜                                         ║
║  ─────────────────────                          ║
║  ✦ ai                                           ║
║                                                  ║
║  👑 𝗢𝗪𝗡𝗘𝗥                                      ║
║  ─────────────────────                          ║
║  ✦ alive                                        ║
║  ✦ anticall                                     ║
║  ✦ antidelete                                   ║
║  ✦ antidelstatus                                ║
║  ✦ autobio                                      ║
║  ✦ leave                                        ║
║  ✦ unblock                                      ║
║  ✦ vv                                           ║
║                                                  ║
║  ⚙️ 𝗦𝗘𝗧𝗧𝗜𝗡𝗚𝗦                                  ║
║  ─────────────────────                          ║
║  ✦ autorecording                                ║
║  ✦ autotyping                                   ║
║  ✦ anticall                                     ║
║  ✦ welcome                                      ║
║  ✦ goodbye                                      ║
║  ✦ autoread                                     ║
║  ✦ autoviewsview                                ║
║  ✦ autolikestatus                               ║
║  ✦ mode                                         ║
║  ✦ setprefix                                    ║
║                                                  ║
║  📱 𝗦𝗬𝗦𝗧𝗘𝗠                                      ║
║  ─────────────────────                          ║
║  ✦ menu                                         ║
║                                                  ║
║  📥 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗                                  ║
║  ─────────────────────                          ║
║  ✦ apk                                          ║
║  ✦ fb                                           ║
║  ✦ pair                                         ║
║  ✦ pair2                                        ║
║  ✦ igdl4                                        ║
║  ✦ igdl2                                        ║
║  ✦ song                                         ║
║  ✦ video                                        ║
║                                                  ║
║  🎨 𝗦𝗧𝗜𝗖𝗞𝗘𝗥                                    ║
║  ─────────────────────                          ║
║  ✦ attp                                         ║
║                                                  ║
║  🔞 𝗔𝗗𝗨𝗟𝗧                                       ║
║  ─────────────────────                          ║
║  ✦ xxxvideo                                     ║
║                                                  ║
║  👥 𝗚𝗥𝗢𝗨𝗣                                      ║
║  ─────────────────────                          ║
║  ✦ requestlist                                  ║
║  ✦ acceptall                                    ║
║  ✦ rejectall                                    ║
║  ✦ removeadmins                                 ║
║  ✦ promote                                      ║
║  ✦ demote                                       ║
║  ✦ botadmin                                     ║
║  ✦ add                                          ║
║  ✦ tagall                                       ║
║  ✦ hidetag                                      ║
║  ✦ admincheck                                   ║
║  ✦ groupstatus                                  ║
║                                                  ║
║  🛡️ 𝗔𝗗𝗠𝗜𝗡                                      ║
║  ─────────────────────                          ║
║  ✦ kick                                         ║
║  ✦ kickall                                      ║
║  ✦ end                                          ║
║                                                  ║
║  📦 𝗗𝗢𝗪𝗡𝗟𝗢𝗔𝗗𝗘𝗥                                ║
║  ─────────────────────                          ║
║  ✦ gdrive                                       ║
║  ✦ igdl                                         ║
║  ✦ ig3                                          ║
║  ✦ movie                                        ║
║  ✦ movie-select                                 ║
║  ✦ video1                                       ║
║                                                  ║
║  📌 𝗚𝗘𝗡𝗘𝗥𝗔𝗟                                    ║
║  ─────────────────────                          ║
║  ✦ Uptime                                       ║
║  ✦ owner                                        ║
║                                                  ║
║  🔍 𝗦𝗘𝗔𝗥𝗖𝗛                                      ║
║  ─────────────────────                          ║
║  ✦ img                                          ║
║  ✦ yts                                          ║
║                                                  ║
║  🎮 𝗙𝗨𝗡                                         ║
║  ─────────────────────                          ║
║  ✦ leakvideo                                    ║
║  ✦ leakvideo2                                   ║
║  ✦ boobs                                        ║
║  ✦ xgirl                                        ║
║                                                  ║
║  🏠 𝗠𝗔𝗜𝗡                                        ║
║  ─────────────────────                          ║
║  ✦ alive                                        ║
║  ✦ online                                       ║
║  ✦ ping                                         ║
║                                                  ║
║  🛠️ 𝗧𝗢𝗢𝗟𝗦                                      ║
║  ─────────────────────                          ║
║  ✦ simdb                                        ║
║  ✦ screenshot                                   ║
║                                                  ║
╠══════════════════════════════════════════════════╣
║                                                  ║
║     ✦ 𝗣𝗼𝘄𝗲𝗿𝗲𝗱 𝗕𝘆 𝗠𝗨𝗭𝗔𝗠𝗜𝗟-𝗫𝗗 ✦              ║
║                                                  ║
╚══════════════════════════════════════════════════╝`;

        await conn.sendMessage(m.chat, {
            image: { url: "https://i.ibb.co/Y7Jyd15p/1000039546.png" },
            caption: menuText,
            contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                mentionedJid: [m.sender],
                forwardedNewsletterMessageInfo: {
                    newsletterJid: "120363426106687970@newsletter",
                    newsletterName: "MUZAMIL-XD",
                    serverMessageId: 2,
                },
            },
        }, { quoted: fakevCard });

    } catch (err) {
        console.error("AllMenu Error:", err);
        reply("❌ Error while generating menu.");
    }
});