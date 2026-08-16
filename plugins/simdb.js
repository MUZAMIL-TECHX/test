const { cmd } = require('../arslan');
const axios = require('axios');

cmd({
    pattern: "simdb",
    alias: ["siminfo", "cnicinfo", "simdata", "simcheck", "simsearch"],
    react: "📱",
    desc: "Get SIM information via CNIC or Mobile Number",
    category: "tools",
    use: ".simdb <CNIC/Mobile Number>",
    filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
    try {
        if (!q) {
            return reply(
                `╔═══════════════════════════════════╗
║     📱 *SIM DATABASE PRO* 📱     ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Command Usage:*              ║
║  ✦ .simdb <CNIC or Number>       ║
║                                   ║
║  ✦ *Examples:*                   ║
║  ✦ .simdb 4120110609811          ║
║  ✦ .simdb 03060931449            ║
║                                   ║
║  ✦ *Features:*                   ║
║  ✦ 🔍 Search by CNIC             ║
║  ✦ 📱 Search by Mobile Number    ║
║  ✦ 📊 Detailed SIM Information   ║
║  ✦ ⚡ Fast & Accurate Results     ║
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
║     🔍 *SEARCHING DATABASE* 🔍    ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Query* : ${q}                    ║
║  ✦ *Status* : ⏳ *Processing*      ║
║  ✦ *Mode*   : 📡 *Real-time*      ║
║                                   ║
╚═══════════════════════════════════╝`
        );

        // API Call
        const apiUrl = `https://wasifali.biz.id/public_apis/sim-info-api.php?search=${encodeURIComponent(q)}`;
        const response = await axios.get(apiUrl, { timeout: 30000 });

        const data = response.data;

        if (!data.success || !data.records || data.records.length === 0) {
            await conn.sendMessage(from, {
                react: { text: "❌", key: m.key }
            });
            return reply(
                `╔═══════════════════════════════════╗
║     ❌ *NO RESULTS FOUND* ❌     ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Query* : ${q}                    ║
║  ✦ *Status* : ❌ *Not Found*      ║
║                                   ║
║  ═══════════════════════════════  ║
║  💡 *Tips:*                       ║
║  ✦ Check CNIC (13 digits)         ║
║  ✦ Check Number (11 digits)       ║
║  ✦ Remove spaces/special chars   ║
║  ✦ Try again with correct input  ║
║                                   ║
╚═══════════════════════════════════╝`
            );
        }

        // Send each record as separate card
        for (let i = 0; i < data.records.length; i++) {
            const record = data.records[i];
            const isFound = record.name !== "NOT FOUND";
            
            const statusEmoji = isFound ? "✅" : "❌";
            const statusText = isFound ? "FOUND" : "NOT FOUND";
            
            const networkEmoji = record.network === "Jazz" ? "🟣" : 
                               record.network === "Zong" ? "🟢" :
                               record.network === "Telenor" ? "🔴" :
                               record.network === "Ufone" ? "🟡" : "📶";

            const card = 
                `╔═══════════════════════════════════╗
║    📋 *SIM CARD ${i + 1}*    ║
╠═══════════════════════════════════╣
║                                   ║
║  ${statusEmoji} *Status* : ${statusText}        ║
║  👤 *Name* : ${isFound ? record.name : "🔒 Private"}  ║
║  📱 *Number* : ${record.mobile}     ║
║  🆔 *CNIC* : ${record.cnic}         ║
║  ${networkEmoji} *Network* : ${record.network}      ║
║  📍 *Address* : ${isFound ? record.address : "🔒 Private"}  ║
║                                   ║
╚═══════════════════════════════════╝`;

            await conn.sendMessage(from, {
                text: card
            }, { quoted: mek });
        }

        // Final footer
        await conn.sendMessage(from, {
            text: 
                `╔═══════════════════════════════════╗
║  ✨ *SEARCH COMPLETE* ✨         ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Total Found* : ${data.count}     ║
║  ✦ *Powered By* : MUZAMIL-XD     ║
║  ✦ *Status* : 🟢 *Online*        ║
║                                   ║
╚═══════════════════════════════════╝`
        }, { quoted: mek });

        await conn.sendMessage(from, {
            react: { text: "✅", key: m.key }
        });

    } catch (e) {
        console.error("SIMDB ERROR:", e);
        await conn.sendMessage(from, {
            react: { text: "❌", key: m.key }
        });
        reply(
            `╔═══════════════════════════════════╗
║     ❌ *SYSTEM ERROR* ❌        ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Error* : ${e.message || "API Failed"}  ║
║  ✦ *Status* : 🔴 *Offline*       ║
║                                   ║
║  ═══════════════════════════════  ║
║  💡 *Solutions:*                  ║
║  ✦ Check your internet           ║
║  ✦ Try again in 5 minutes        ║
║  ✦ Use correct format            ║
║                                   ║
╚═══════════════════════════════════╝`
        );
    }
});