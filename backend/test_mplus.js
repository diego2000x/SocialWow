require("dotenv").config();
const axios = require("axios");

async function test() {
  // 1. Obtener token
  const tokenRes = await axios.post(
    "https://oauth.battle.net/token",
    "grant_type=client_credentials",
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      auth: {
        username: process.env.CLIENT_ID,
        password: process.env.CLIENT_SECRET,
      },
    },
  );
  const token = tokenRes.data.access_token;
  console.log("Token obtenido OK\n");

  const realm = "quelthalas";
  const name = "dsjunior"; // Puedes cambiar por otro personaje

  // 2. Consultar perfil M+ (sin temporada)
  try {
    const profileRes = await axios.get(
      `https://us.api.blizzard.com/profile/wow/character/${realm}/${name}/mythic-keystone-profile`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { namespace: "profile-us", locale: "es_MX" },
      },
    );
    console.log("=== PERFIL M+ (sin temporada) ===");
    console.log("Keys del objeto:", Object.keys(profileRes.data));
    console.log(JSON.stringify(profileRes.data, null, 2));
  } catch (err) {
    console.log("Error perfil M+:", err.response?.status, err.response?.data);
  }

  // 3. Consultar perfil M+ por temporada actual
  // Primero obtener el ID de la temporada actual
  try {
    const profileRes = await axios.get(
      `https://us.api.blizzard.com/profile/wow/character/${realm}/${name}/mythic-keystone-profile`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { namespace: "profile-us", locale: "es_MX" },
      },
    );

    const seasons = profileRes.data.seasons;
    if (seasons && seasons.length > 0) {
      const latestSeasonId = seasons[seasons.length - 1].id;
      console.log(`\n=== PERFIL M+ TEMPORADA ${latestSeasonId} ===`);

      const seasonRes = await axios.get(
        `https://us.api.blizzard.com/profile/wow/character/${realm}/${name}/mythic-keystone-profile/season/${latestSeasonId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params: { namespace: "profile-us", locale: "es_MX" },
        },
      );
      console.log("Keys del objeto:", Object.keys(seasonRes.data));
      console.log(JSON.stringify(seasonRes.data, null, 2));
    } else {
      console.log("No se encontraron temporadas.");
    }
  } catch (err) {
    console.log("Error temporada M+:", err.response?.status, err.response?.data);
  }
}

test().catch(console.error);
