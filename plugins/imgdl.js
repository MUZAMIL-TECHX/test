const { cmd } = require('../arslan');
const axios = require('axios');

cmd({
    pattern: "img",
    alias: ["pinterest", "pin", "image", "pic", "photo"],
    react: "🖼️",
    desc: "Search and get images from Pinterest",
    category: "search",
    use: ".img <search query>",
    filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
    try {
        if (!q) {
            return reply(
                `╔═══════════════════════════════════╗
║     🖼️ *PINTEREST IMAGE SEARCH* 🖼️  ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Command Usage:*              ║
║  ✦ .img <search query>           ║
║                                   ║
║  ✦ *Examples:*                   ║
║  ✦ .img car                      ║
║  ✦ .img nature wallpaper         ║
║  ✦ .img anime girl               ║
║                                   ║
║  ✦ *Features:*                   ║
║  ✦ 🖼️ High quality images        ║
║  ✦ 📸 3 images per search        ║
║  ✦ ⚡ Fast & accurate results     ║
║  ✦ 🎯 Best match selection        ║
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
║     🔍 *SEARCHING IMAGES* 🔍     ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Query* : ${q}                    ║
║  ✦ *Status* : ⏳ *Processing*      ║
║  ✦ *Mode*   : 📡 *Pinterest*      ║
║  ✦ *Limit*  : 🖼️ 3 Images        ║
║                                   ║
╚═══════════════════════════════════╝`
        );

        // API Call
        const apiUrl = `https://allstars-apis.vercel.app/pinterest?search=${encodeURIComponent(q)}`;
        const response = await axios.get(apiUrl, { timeout: 30000 });

        const data = response.data;

        if (!data.data || data.data.length === 0) {
            await conn.sendMessage(from, {
                react: { text: "❌", key: m.key }
            });
            return reply(
                `╔═══════════════════════════════════╗
║     ❌ *NO IMAGES FOUND* ❌     ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Query* : ${q}                    ║
║  ✦ *Status* : ❌ *Not Found*      ║
║                                   ║
║  ═══════════════════════════════  ║
║  💡 *Tips:*                       ║
║  ✦ Try different keywords         ║
║  ✦ Use simpler search terms      ║
║  ✦ Check spelling                 ║
║  ✦ Try again with new query      ║
║                                   ║
╚═══════════════════════════════════╝`
            );
        }

        // Get first 3 images
        const images = data.data.slice(0, 3);
        const totalImages = data.data.length;

        // Send each image with card
        for (let i = 0; i < images.length; i++) {
            const imageUrl = images[i];
            
            const card = 
                `╔═══════════════════════════════════╗
║    🖼️ *IMAGE ${i + 1} OF 3*    ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Query* : ${q}                    ║
║  ✦ *Total* : ${totalImages} found    ║
║  ✦ *Source* : Pinterest           ║
║  ✦ *Quality* : 📸 *HD*           ║
║                                   ║
╚═══════════════════════════════════╝`;

            await conn.sendMessage(from, {
                image: { url: imageUrl },
                caption: card
            }, { quoted: mek });
        }

        // Final footer
        await conn.sendMessage(from, {
            text: 
                `╔═══════════════════════════════════╗
║  ✨ *SEARCH COMPLETE* ✨         ║
╠═══════════════════════════════════╣
║                                   ║
║  ✦ *Query* : ${q}                    ║
║  ✦ *Found* : ${images.length} images  ║
║  ✦ *Total* : ${totalImages} available ║
║  ✦ *Powered By* : MUZAMIL-XD      ║
║  ✦ *Status* : 🟢 *Online*        ║
║                                   ║
╚═══════════════════════════════════╝`
        }, { quoted: mek });

        await conn.sendMessage(from, {
            react: { text: "✅", key: m.key }
        });

    } catch (e) {
        console.error("PINTEREST ERROR:", e);
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
║  ✦ Use different keywords        ║
║  ✦ Try again with new query      ║
║                                   ║
╚═══════════════════════════════════╝`
        );
    }
});