const { cmd } = require("../arslan");
const moment = require("moment-timezone");
const { fakevCard } = require('../lib/fakevCard');

cmd({
    pattern: "menu",
    alias: ["commandlist", "allmenu", "help"],
    desc: "Display all available bot commands",
    category: "system",
    filename: __filename,
}, async (conn, mek, m, { from, reply }) => {
    try {
        // Menu reaction
        await conn.sendMessage(from, {
            react: { text: "📜", key: m.key }
        });

        const time = moment().tz("Africa/Kampala").format("HH:mm:ss");
        const date = moment().tz("Africa/Kampala").format("dddd, MMMM Do YYYY");

        const menuText = `
╭━━━〔 👤 *MUZAMIL-XD* 〕━━━┈⊷

┃ ❍ Mode » [public]
┃ ❍ Prefix » [.]
┃ ❍ Runtime » 2 hours, 26 minutes, 37 seconds
┃ ❍ Creater » MUZAMIL-XD
┃ ❍ Commands » Protection commands available
╰━━━━━━━━━━━━━━━━┈⊷
╭━━━〔 🤖 AI MENU 〕
┃ ❍ ai [query]
┃ ❍ darkai [query]
┃ ❍ workai [query]
┃ ❍ ask [query]
┃ ❍ chatgpt [query]
┃ ❍ gpt [query]
┃ ❍ aiask [query]
╰━━━━━━━━━━━━━━━━┈⊷

╭━━━〔 👑 OWNER MENU 〕
┃ ❍ antidelete
╰━━━━━━━━━━━━━━━━┈⊷

╭━━━〔 ⚙️ SETTINGS MENU 〕
┃ ❍ Owner settings are disabled in this build
╰━━━━━━━━━━━━━━━━┈⊷

╭━━━〔 📥 DOWNLOAD MENU 〕
┃ ❍ apk [name]
┃ ❍ fb [url]
┃ ❍ pair
┃ ❍ pair2
┃ ❍ igdl4 [url]
┃ ❍ igdl2 [url]
┃ ❍ song [name]
┃ ❍ video [name]
┃ ❍ gdrive [url]
┃ ❍ igdl [url]
┃ ❍ ig3 [url]
┃ ❍ movie [name]
┃ ❍ video1 [name]
╰━━━━━━━━━━━━━━━━┈⊷

╭━━━〔 🎨 STICKER MENU 〕
┃ ❍ attp [text]
┃ ❍ attptext [text]
┃ ❍ textsticker [text]
┃ ❍ namesticker [text]
┃ ❍ stickername [text]
┃ ❍ at [text]
┃ ❍ att [text]
┃ ❍ atp [text]
╰━━━━━━━━━━━━━━━━┈⊷

╭━━━〔 👥 GROUP MENU 〕
┃ ❍ requestlist
┃ ❍ acceptall
┃ ❍ rejectall
┃ ❍ removeadmins
┃ ❍ promote @user
┃ ❍ demote @user
┃ ❍ botadmin
┃ ❍ add @user
┃ ❍ tagall [msg]
┃ ❍ hidetag [msg]
┃ ❍ admincheck
┃ ❍ groupstatus
╰━━━━━━━━━━━━━━━━┈⊷

╭━━━〔 🛡️ ADMIN MENU 〕
┃ ❍ antilink
┃ ❍ kick @user
┃ ❍ kickall
┃ ❍ end
╰━━━━━━━━━━━━━━━━┈⊷

╭━━━〔 🔍 SEARCH MENU 〕
┃ ❍ img [query]
┃ ❍ yts [query]
╰━━━━━━━━━━━━━━━━┈⊷

╭━━━〔 🎮 FUN MENU 〕
┃ ❍ leakvideo
┃ ❍ leakvideo2
┃ ❍ boobs
┃ ❍ xgirl
┃ ❍ xxxvideo
╰━━━━━━━━━━━━━━━━┈⊷

╭━━━〔 🏠 MAIN MENU 〕
┃ ❍ alive
┃ ❍ online
┃ ❍ ping
┃ ❍ menu
┃ ❍ Uptime
┃ ❍ owner
╰━━━━━━━━━━━━━━━━┈⊷

╭━━━〔 🛠️ TOOLS MENU 〕
┃ ❍ simdb [cnic/number]
┃ ❍ screenshot [url]
╰━━━━━━━━━━━━━━━━┈⊷

> 𝐂𝐑𝐄𝐀𝐓𝐄𝐑: MUZAMIL-XD`;

        await conn.sendMessage(from, {
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
