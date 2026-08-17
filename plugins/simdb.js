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

        // API Call - Fixed with proper encoding
        const apiUrl = `https://wasifali.biz.id/public_apis/sim-info-api.php?search=${encodeURIComponent(q)}`;
        const response = await axios.get(apiUrl, { 
            timeout: 30000,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            }
        });

        const data = response.data;

        // Check if response is valid
        if (!data || !data.success) {
            await conn.sendMessage(from, {
                react: { text: "❌", key: m.key }
            });
            return reply(
                `*_MUZAMIL-XD_*
❌ API Error: ${data?.message || "Invalid response from server"}

> Powered By MUZAMIL-XD`
            );
        }

        if (!data.records || data.records.length === 0) {
            await conn.sendMessage(from, {
                react: { text: "❌", key: m.key }
            });
            return reply(
                `*_MUZAMIL-XD_*
❌ No SIM information found for: ${q}

💡 Tips:
• Check CNIC (13 digits)
• Check Number (11 digits)
• Remove spaces/special characters

> Powered By MUZAMIL-XD`
            );
        }

        // Build response text
        let responseText = `*_MUZAMIL-XD_*\n\n📱 *SIM DATABASE RESULTS*\n📊 *Total Records:* ${data.count}\n\n`;

        for (let i = 0; i < data.records.length; i++) {
            const record = data.records[i];
            const isFound = record.name !== "NOT FOUND";
            
            const statusEmoji = isFound ? "✅" : "❌";
            const statusText = isFound ? "FOUND" : "NOT FOUND";
            
            const networkEmoji = record.network === "Jazz" ? "📶" : 
                               record.network === "Zong" ? "📶" :
                               record.network === "Telenor" ? "📶" :
                               record.network === "Ufone" ? "📶" : "📶";

            responseText += `━━━━━━━━━━━━━━━━━━━━━\n`;
            responseText += `📋 *RECORD ${i + 1}*\n`;
            responseText += `${statusEmoji} Status: ${statusText}\n`;
            responseText += `👤 Name: ${isFound ? record.name : "🔒 Private"}\n`;
            responseText += `📱 Number: ${record.mobile}\n`;
            responseText += `🆔 CNIC: ${record.cnic}\n`;
            responseText += `${networkEmoji} Network: ${record.network}\n`;
            responseText += `📍 Address: ${isFound ? record.address : "🔒 Private"}\n`;
        }

        responseText += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
        responseText += `> Powered By MUZAMIL-XD`;

        // Send response
        await conn.sendMessage(from, {
            text: responseText
        }, { quoted: mek });

        await conn.sendMessage(from, {
            react: { text: "✅", key: m.key }
        });

    } catch (e) {
        console.error("SIMDB ERROR:", e);
        await conn.sendMessage(from, {
            react: { text: "❌", key: m.key }
        });
        
        let errorMessage = e.message || "Unknown error";
        if (e.code === 'ECONNABORTED') {
            errorMessage = "Request timeout - Server taking too long";
        } else if (e.response?.status === 400) {
            errorMessage = "Invalid request - Please check your input";
        } else if (e.response?.status === 404) {
            errorMessage = "API endpoint not found - Service might be down";
        } else if (e.response?.status === 500) {
            errorMessage = "Server error - Try again later";
        }

        reply(
            `*_MUZAMIL-XD_*
❌ Error: ${errorMessage}

💡 Solutions:
• Check your internet connection
• Try again in 5 minutes
• Use correct format (CNIC: 13 digits, Number: 11 digits)
• Try a different query

> Powered By MUZAMIL-XD`
        );
    }
});