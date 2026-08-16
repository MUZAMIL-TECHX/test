const { cmd } = require('../arslan');
const axios = require('axios');

cmd({
  pattern: "fb",
  react: "☺️",
  alias: ["facebook", "fbdl"],
  category: "download",
  filename: __filename
}, async (conn, mek, m, { from, q, reply }) => {
  try {
    if (!q) return reply("*YOU WANT TO DOWNLOAD A FACEBOOK VIDEO 🤔 SO COPY THE LINK OF THAT FACEBOOK VIDEO 🤗*\n*THEN TYPE LIKE THIS ☺️*\n\n*FB ❮FACEBOOK VIDEO LINK❯*\n\n*WHEN YOU TYPE LIKE THIS 😇 YOUR FACEBOOK VIDEO WILL BE DOWNLOADED 😃 AND SENT HERE 😍♥️*");

    const apiUrl = `https://movanest.xyz/v2/fbdown?url=${encodeURIComponent(q)}`;
    const res = await axios.get(apiUrl);
    const data = res.data;

    // 🔎 API status check
    if (data.status !== true) {
      return reply("API ERROR 😢");
    }

    // 🔎 Results check
    if (!Array.isArray(data.results) || data.results.length === 0) {
      return reply("*FACEBOOK VIDEO NOT FOUND 🥺*");
    }

    const result = data.results[0];

    // 🎥 Quality selection
    const videoUrl = result.hdQualityLink
      ? result.hdQualityLink
      : result.normalQualityLink;

    if (!videoUrl) {
      return reply("*ONLY GIVE FACEBOOK VIDEO LINK ☺️*");
    }

    // 📝 Caption from API data
    const caption = `*👑 FB VIDEO 👑*
*👑 TIME :❯ ${result.duration}*
*👑 CREATOR :❯ ${data.creator}*
*👑 BY :❯ MUZAMIL-XD 👑*`;

    await conn.sendMessage(
      from,
      {
        video: { url: videoUrl },
        mimetype: "video/mp4",
        caption: caption
      },
      { quoted: mek }
    );

  } catch (err) {
    console.log(err);
    reply("❌ Error occurred");
  }
});