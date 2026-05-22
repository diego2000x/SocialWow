require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(cors());

app.get("/", (req, res) => {
  res.json({
    mensaje: "Backend WoW funcionando",
  });
});

app.listen(3000, () => {
  console.log("Servidor activo en puerto 3000");
});

let cachedToken = null;
let tokenExpiresAt = 0; // Timestamp en ms

// Caché de personajes en memoria
const characterCache = {};
const CHARACTER_CACHE_TTL = 10 * 60 * 1000; // 10 minutos en ms

// Caché de guilds y búsquedas
const guildCache = {};
const searchCache = {};
const SEARCH_CACHE_TTL = 5 * 60 * 1000; // 5 minutos en ms

// Ruta del archivo de logros local
const achievementsFilePath = path.join(__dirname, "data", "achievements_es.json");
const mplusNameMapFilePath = path.join(__dirname, "data", "mplus_dungeon_name_map.json");
let achievementsLocal = {};
const mythicDungeonMediaCache = {};
let mythicDungeonNameMapCache = null;
let mythicDungeonNameMapCacheAt = 0;
const MYTHIC_DUNGEON_NAME_MAP_TTL = 24 * 60 * 60 * 1000;
let manualDungeonNameMap = {};
let warmupState = {
  running: false,
  startedAt: null,
  finishedAt: null,
  lastResult: null,
  lastError: null,
};

function normalizeText(value) {
  if (!value) {
    return "";
  }

  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function extractDungeonNameFromAchievement(achievementName) {
  if (!achievementName) {
    return null;
  }

  const parts = achievementName.split(":");
  if (parts.length < 2) {
    return null;
  }

  const prefix = normalizeText(parts[0]);
  const isMPlusDungeonAchievement =
    prefix.includes("heroe de piedra angular") ||
    prefix.includes("keystone hero");

  if (!isMPlusDungeonAchievement) {
    return null;
  }

  const dungeonName = parts.slice(1).join(":").trim();
  return dungeonName || null;
}

function isKeystoneDungeonHeroAchievementName(achievementName) {
  const dungeonName = extractDungeonNameFromAchievement(achievementName);
  return Boolean(dungeonName);
}

async function fetchAndCacheAchievementById(token, achievementId) {
  if (
    achievementsLocal[achievementId] &&
    achievementsLocal[achievementId].icon !== undefined
  ) {
    return achievementsLocal[achievementId];
  }

  const achievementRes = await axios.get(
    `https://us.api.blizzard.com/data/wow/achievement/${achievementId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      params: {
        namespace: "static-us",
        locale: "es_MX",
      },
    },
  );

  const mediaRes = await axios.get(
    `https://us.api.blizzard.com/data/wow/media/achievement/${achievementId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      params: {
        namespace: "static-us",
      },
    },
  );

  const icon =
    mediaRes.data.assets.find((asset) => asset.key === "icon")?.value || null;

  const achievementClean = {
    id: achievementRes.data.id,
    name: achievementRes.data.name,
    description: achievementRes.data.description,
    points: achievementRes.data.points,
    icon: icon,
  };

  achievementsLocal[achievementId] = achievementClean;
  return achievementClean;
}

function normalizeMythicRun(run) {
  if (!run || !run.completed_timestamp) {
    return null;
  }

  return {
    completed_timestamp: run.completed_timestamp,
    dungeonId: run.dungeon?.id ?? null,
    mapChallengeModeId: run.map_challenge_mode?.id ?? null,
    dungeon: run.dungeon?.name || "Calabozo desconocido",
    keystone_level: run.keystone_level ?? null,
    upgrades: run.num_keystone_upgrades ?? 0,
    score: run.score ?? null,
  };
}

async function getDungeonIcon(token, run) {
  const cacheKey = `${run?.mapChallengeModeId || "none"}_${run?.dungeonId || "none"}`;
  if (!run || (!run.mapChallengeModeId && !run.dungeonId)) {
    return null;
  }

  if (Object.prototype.hasOwnProperty.call(mythicDungeonMediaCache, cacheKey)) {
    return mythicDungeonMediaCache[cacheKey];
  }

  try {
    // map_challenge_mode describe mejor la run concreta de M+.
    if (run.mapChallengeModeId) {
      const mapMediaRes = await axios.get(
        `https://us.api.blizzard.com/data/wow/media/map/${run.mapChallengeModeId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params: {
            namespace: "static-us",
            locale: "en_US",
          },
        },
      );

      const mapIcon =
        mapMediaRes.data?.assets?.find((asset) => asset.key === "tile")?.value ||
        mapMediaRes.data?.assets?.find((asset) => asset.key === "icon")?.value ||
        mapMediaRes.data?.assets?.[0]?.value ||
        null;

      if (mapIcon) {
        mythicDungeonMediaCache[cacheKey] = mapIcon;
        return mapIcon;
      }
    }

    if (run.dungeonId) {
      const mediaRes = await axios.get(
        `https://us.api.blizzard.com/data/wow/media/journal-instance/${run.dungeonId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params: {
            namespace: "static-us",
            locale: "en_US",
          },
        },
      );

      const icon =
        mediaRes.data?.assets?.find((asset) => asset.key === "icon")?.value ||
        mediaRes.data?.assets?.[0]?.value ||
        null;

      mythicDungeonMediaCache[cacheKey] = icon;
      return icon;
    }
  } catch (error) {
    console.log(
      `No se pudo obtener icono de calabozo ${cacheKey}:`,
      error.response?.data || error.message,
    );
    mythicDungeonMediaCache[cacheKey] = null;
    return null;
  }

  mythicDungeonMediaCache[cacheKey] = null;
  return null;
}

async function getMythicPlusData(token, realm, name) {
  const mythicProfileRes = await axios.get(
    `https://us.api.blizzard.com/profile/wow/character/${realm}/${name}/mythic-keystone-profile`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      params: {
        namespace: "profile-us",
        locale: "en_US",
      },
    },
  );

  const profile = mythicProfileRes.data || {};
  const currentPeriod = profile.current_period || {};

  const runs = [
    ...(currentPeriod.runs || []),
    ...(currentPeriod.best_runs || []),
  ]
    .map(normalizeMythicRun)
    .filter(Boolean)
    .sort((a, b) => b.completed_timestamp - a.completed_timestamp);

  const recentRuns = runs.slice(0, 5).map((run) => ({
    ...run,
    icon: null,
  }));

  return {
    currentRating: profile.current_mythic_rating?.rating ?? null,
    recentRuns,
  };
}

async function getMythicDungeonNameMap(token) {
  if (
    mythicDungeonNameMapCache &&
    Date.now() - mythicDungeonNameMapCacheAt < MYTHIC_DUNGEON_NAME_MAP_TTL
  ) {
    return mythicDungeonNameMapCache;
  }

  const [enRes, esRes] = await Promise.all([
    axios.get("https://us.api.blizzard.com/data/wow/mythic-keystone/dungeon/index", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      params: {
        namespace: "dynamic-us",
        locale: "en_US",
      },
    }),
    axios.get("https://us.api.blizzard.com/data/wow/mythic-keystone/dungeon/index", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      params: {
        namespace: "dynamic-us",
        locale: "es_MX",
      },
    }),
  ]);

  const esById = {};
  (esRes.data?.dungeons || []).forEach((dungeon) => {
    esById[dungeon.id] = dungeon.name;
  });

  const map = {};
  (enRes.data?.dungeons || []).forEach((dungeon) => {
    const enName = normalizeText(dungeon.name);
    map[enName] = {
      id: dungeon.id,
      enName: dungeon.name,
      esName: esById[dungeon.id] || null,
    };
  });

  mythicDungeonNameMapCache = map;
  mythicDungeonNameMapCacheAt = Date.now();
  return map;
}

async function warmGuildAchievementCache(token, options = {}) {
  const realm = "quelthalas";
  const guild = "resilient-renegades";
  const maxMembers = options.maxMembers || 80;
  const recentPerCharacter = options.recentPerCharacter || 40;
  const onlyKeystoneHeroes = options.onlyKeystoneHeroes !== false;
  const scanConcurrency = Math.max(1, Math.min(options.scanConcurrency || 8, 20));
  const cacheConcurrency = Math.max(1, Math.min(options.cacheConcurrency || 10, 25));
  const startedAt = Date.now();

  const rosterRes = await axios.get(
    `https://us.api.blizzard.com/data/wow/guild/${realm}/${guild}/roster`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      params: {
        namespace: "profile-us",
        locale: "en_US",
      },
    },
  );

  const members = (rosterRes.data.members || [])
    .slice(0, maxMembers)
    .map((m) => m.character)
    .filter(Boolean);

  const candidateIds = new Set();
  let scannedCharacters = 0;
  let scanFailures = 0;

  async function scanMemberAchievements(member) {
    try {
      const achievementsRes = await axios.get(
        `https://us.api.blizzard.com/profile/wow/character/${member.realm.slug}/${member.name.toLowerCase()}/achievements`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params: {
            namespace: "profile-us",
            locale: "en_US",
          },
        },
      );

      const recent = (achievementsRes.data.achievements || [])
        .filter((a) => a.completed_timestamp)
        .sort((a, b) => b.completed_timestamp - a.completed_timestamp)
        .slice(0, recentPerCharacter);

      recent.forEach((a) => {
        if (a.achievement?.id) {
          candidateIds.add(a.achievement.id);
        }
      });

      scannedCharacters += 1;
    } catch (error) {
      scanFailures += 1;
      console.log(
        `No se pudo escanear logros de ${member.name}:`,
        error.response?.data || error.message,
      );
    }
  }

  for (let i = 0; i < members.length; i += scanConcurrency) {
    const chunk = members.slice(i, i + scanConcurrency);
    await Promise.all(chunk.map((member) => scanMemberAchievements(member)));
  }

  let cachedNow = 0;
  let cacheFailures = 0;
  const candidateIdList = [...candidateIds];

  async function cacheAchievement(id) {
    try {
      const achievementData = await fetchAndCacheAchievementById(token, id);

      if (onlyKeystoneHeroes && !isKeystoneDungeonHeroAchievementName(achievementData.name)) {
        return;
      }

      cachedNow += 1;
    } catch (error) {
      cacheFailures += 1;
      console.log(
        `No se pudo cachear logro ${id}:`,
        error.response?.data || error.message,
      );
    }
  }

  for (let i = 0; i < candidateIdList.length; i += cacheConcurrency) {
    const chunk = candidateIdList.slice(i, i + cacheConcurrency);
    await Promise.all(chunk.map((id) => cacheAchievement(id)));
  }

  await fs.promises.writeFile(
    achievementsFilePath,
    JSON.stringify(achievementsLocal, null, 2),
    "utf8",
  );

  return {
    scannedCharacters,
    scanFailures,
    candidateAchievements: candidateIds.size,
    cachedNow,
    cacheFailures,
    totalCachedAchievements: Object.keys(achievementsLocal).length,
    elapsedMs: Date.now() - startedAt,
    scanConcurrency,
    cacheConcurrency,
  };
}

// Cargar logros locales al inicio
try {
  if (fs.existsSync(achievementsFilePath)) {
    const fileData = fs.readFileSync(achievementsFilePath, "utf8");
    achievementsLocal = JSON.parse(fileData);
    console.log(`Logros cargados desde el caché local: ${Object.keys(achievementsLocal).length}`);
  } else {
    console.log("No se encontró archivo de caché local de logros. Se creará uno nuevo.");
  }
} catch (error) {
  console.error("Error al cargar logros locales:", error);
}

try {
  if (fs.existsSync(mplusNameMapFilePath)) {
    const fileData = fs.readFileSync(mplusNameMapFilePath, "utf8");
    const rawMap = JSON.parse(fileData);
    manualDungeonNameMap = Object.fromEntries(
      Object.entries(rawMap).map(([enName, esName]) => [normalizeText(enName), esName]),
    );
    console.log(`Mapa manual de calabozos M+ cargado: ${Object.keys(manualDungeonNameMap).length}`);
  } else {
    console.log("No se encontró mapa manual de calabozos M+.");
  }
} catch (error) {
  console.error("Error al cargar mapa manual de calabozos M+:", error);
}

async function getAccessToken() {
  const now = Date.now();
  // Si el token ya existe y le queda al menos 1 minuto de validez, lo reutilizamos
  if (cachedToken && now < tokenExpiresAt - 60000) {
    console.log("Reutilizando token de Blizzard en caché");
    return cachedToken;
  }

  console.log("Obteniendo nuevo token de Blizzard OAuth...");
  const response = await axios.post(
    "https://oauth.battle.net/token",
    "grant_type=client_credentials",
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      auth: {
        username: process.env.CLIENT_ID,
        password: process.env.CLIENT_SECRET,
      },
    },
  );
  
  cachedToken = response.data.access_token;
  // expires_in viene en segundos (usualmente 86399 o similar)
  tokenExpiresAt = Date.now() + response.data.expires_in * 1000;
  
  return cachedToken;
}

app.get("/guild/:realm/:guildName", async (req, res) => {
  try {
    const token = await getAccessToken();
    const { realm, guildName } = req.params;
    const cleanRealm = realm.toLowerCase();
    const cleanGuild = guildName.toLowerCase();

    const response = await axios.get(
      `https://us.api.blizzard.com/data/wow/guild/${cleanRealm}/${cleanGuild}/roster`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          namespace: "profile-us",
          locale: "en_US",
        },
      },
    );

    // Guardar en guildCache para el buscador
    const gk = `${cleanRealm}_${cleanGuild}`;
    guildCache[gk] = {
      name: response.data.guild?.name ?? guildName,
      realm: cleanRealm,
      memberCount: response.data.members?.length ?? 0,
    };

    res.json(response.data);
  } catch (error) {
    console.log(error.response?.data || error.message);

    res.status(500).json({
      error: "No se pudo obtener guild",
    });
  }
});

app.get("/search", async (req, res) => {
  const q    = (req.query.q || "").toLowerCase().trim();
  const mode = req.query.mode === "guild" ? "guild" : "character";

  if (!q || q.length < 2) {
    return res.json({ results: [] });
  }

  const cacheKey = `${mode}:${q}`;

  // Devolver caché si sigue vigente
  if (searchCache[cacheKey] && Date.now() - searchCache[cacheKey].cachedAt < SEARCH_CACHE_TTL) {
    return res.json({ results: searchCache[cacheKey].results, fromCache: true });
  }

  try {
    const token = await getAccessToken();
    let results = [];

    if (mode === "character") {
      const searchRes = await axios.get(
        "https://us.api.blizzard.com/profile/wow/character/search",
        {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            namespace: "profile-us",
            name: q,
            orderby: "level",
            _pageSize: 10,
          },
        }
      );

      results = (searchRes.data?.results || []).map((entry) => {
        const char      = entry.data;
        const realmSlug = char.realm?.slug ?? "";
        const name      = char.name ?? "";
        const level     = char.level ?? null;
        const classId   = char.character_class?.id ?? null;
        const className = char.character_class?.name ?? null;

        // Guardar en characterCache para uso futuro
        const ck = `${realmSlug}_${name.toLowerCase()}`;
        if (!characterCache[ck]) {
          characterCache[ck] = {
            data: { name, realmSlug, level, classId, className },
            cachedAt: Date.now(),
          };
        }

        return { name, realm: realmSlug, level, classId, className };
      });

    } else {
      const searchRes = await axios.get(
        "https://us.api.blizzard.com/data/wow/search/guild",
        {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            namespace: "profile-us",
            name: q,
            orderby: "name",
            _pageSize: 10,
          },
        }
      );

      results = (searchRes.data?.results || []).map((entry) => {
        const guild     = entry.data;
        const realmSlug = guild.realm?.slug ?? "";
        const name      = guild.name ?? "";

        // Guardar en guildCache para uso futuro
        const gk = `${realmSlug}_${name.toLowerCase()}`;
        if (!guildCache[gk]) {
          guildCache[gk] = { name, realm: realmSlug };
        }

        return { name, realm: realmSlug };
      });
    }

    searchCache[cacheKey] = { results, cachedAt: Date.now() };
    res.json({ results });

  } catch (error) {
    console.log("Error en /search:", error.response?.data || error.message);

    // Fallback: buscar en caché local si Blizzard falla
    const fallback = mode === "character"
      ? Object.values(characterCache)
          .filter((e) => e.data?.name?.toLowerCase().includes(q))
          .map((e) => ({
            name:      e.data.name,
            realm:     e.data.realmSlug ?? "",
            level:     e.data.level ?? null,
            className: e.data.className ?? null,
          }))
          .slice(0, 8)
      : Object.values(guildCache)
          .filter((g) => g.name.toLowerCase().includes(q))
          .map((g) => ({ name: g.name, realm: g.realm }))
          .slice(0, 8);

    res.json({ results: fallback, fromFallback: true });
  }
});

app.get("/character/:realm/:name", async (req, res) => {
  try {
    const { realm, name } = req.params;
    const forceRefresh = req.query.refresh === "1";
    const cacheKey = `${realm.toLowerCase()}_${name.toLowerCase()}`;
    const cachedCharacter = characterCache[cacheKey];

    // Verificar si el personaje está en caché y sigue siendo válido
    if (
      !forceRefresh &&
      cachedCharacter &&
      Date.now() - cachedCharacter.cachedAt < CHARACTER_CACHE_TTL
    ) {
      console.log(`Reutilizando personaje en caché: ${cacheKey}`);
      return res.json(cachedCharacter.data);
    }

    console.log(`Consultando API de Blizzard para el personaje: ${cacheKey}`);
    const token = await getAccessToken();

    // 1. datos del personaje
    const characterRes = await axios.get(
      `https://us.api.blizzard.com/profile/wow/character/${realm}/${name}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          namespace: "profile-us",
          locale: "en_US",
        },
      },
    );

    // 2. media del personaje (imagen)
    const mediaRes = await axios.get(
      `https://us.api.blizzard.com/profile/wow/character/${realm}/${name}/character-media`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          namespace: "profile-us",
        },
      },
    );
    const [achievementsResult, mythicResult] = await Promise.allSettled([
      axios.get(
        `https://us.api.blizzard.com/profile/wow/character/${realm}/${name}/achievements`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params: {
            namespace: "profile-us",
            locale: "en_US",
          },
        },
      ),
      getMythicPlusData(token, realm, name),
    ]);

    if (achievementsResult.status !== "fulfilled") {
      throw achievementsResult.reason;
    }

    const achievementsRes = achievementsResult.value;
    const mythicPlusData =
      mythicResult.status === "fulfilled"
        ? mythicResult.value
        : { currentRating: null, recentRuns: [] };

    const latestFive = achievementsRes.data.achievements
      .filter((a) => a.completed_timestamp)
      .sort((a, b) => b.completed_timestamp - a.completed_timestamp)
      .slice(0, 5);

    let needsWrite = false;

    const achievementsData = await Promise.all(
      latestFive.map(async (achievement) => {
        const achievementId = achievement.achievement.id;

        // Verificar si el logro está en el caché local y tiene el ícono cargado
        if (achievementsLocal[achievementId] && achievementsLocal[achievementId].icon !== undefined) {
          console.log(`Reutilizando logro en caché local: ${achievementId}`);
          return {
            ...achievementsLocal[achievementId],
            completed_timestamp: achievement.completed_timestamp,
          };
        }

        console.log(`Solicitando datos del logro a Blizzard: ${achievementId}`);
        // Datos del logro
        const achievementRes = await axios.get(
          `https://us.api.blizzard.com/data/wow/achievement/${achievementId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            params: {
              namespace: "static-us",
              locale: "es_MX",
            },
          },
        );

        // Media del logro
        const mediaRes = await axios.get(
          `https://us.api.blizzard.com/data/wow/media/achievement/${achievementId}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            params: {
              namespace: "static-us",
            },
          },
        );

        // Buscar icono
        const icon =
          mediaRes.data.assets.find((asset) => asset.key === "icon")?.value ||
          null;

        const achievementClean = {
          id: achievementRes.data.id,
          name: achievementRes.data.name,
          description: achievementRes.data.description,
          points: achievementRes.data.points,
          icon: icon,
        };

        // Almacenar en memoria
        achievementsLocal[achievementId] = achievementClean;
        needsWrite = true;

        // Retornar logro limpio
        return {
          ...achievementClean,
          completed_timestamp: achievement.completed_timestamp,
        };
      }),
    );

    // Escribir de forma asíncrona si hubo algún logro nuevo
    if (needsWrite) {
      fs.writeFile(achievementsFilePath, JSON.stringify(achievementsLocal, null, 2), (err) => {
        if (err) {
          console.error("Error escribiendo archivo de logros caché:", err);
        } else {
          console.log("Archivo de caché local de logros actualizado con éxito.");
        }
      });
    }

    const mediaMap = {};

    mediaRes.data.assets.forEach((asset) => {
      mediaMap[asset.key] = asset.value;
    });
    const dungeonNameMap = await getMythicDungeonNameMap(token);
    const dungeonIconByName = {};

    // Usar todo el caché local de logros para mapear iconos de calabozos M+.
    // No solo "achievementsData", porque esa lista trae únicamente los logros más recientes.
    Object.values(achievementsLocal).forEach((achievement) => {
      const dungeonName = extractDungeonNameFromAchievement(achievement.name);
      if (!dungeonName || !achievement.icon) {
        return;
      }

      dungeonIconByName[normalizeText(dungeonName)] = achievement.icon;
    });

    const mythicRunsWithAchievementIcons = (mythicPlusData.recentRuns || []).map((run) => {
      const normalizedDungeonNameEn = normalizeText(run.dungeon);
      const dungeonMapEntry = dungeonNameMap[normalizedDungeonNameEn];
      const normalizedDungeonNameEs = normalizeText(dungeonMapEntry?.esName || "");
      const manualMappedEsName = normalizeText(
        manualDungeonNameMap[normalizedDungeonNameEn] || "",
      );

      const iconFromAchievement =
        dungeonIconByName[manualMappedEsName] ||
        dungeonIconByName[normalizedDungeonNameEn] ||
        dungeonIconByName[normalizedDungeonNameEs];

      return {
        ...run,
        // Usar solo icono derivado de logro (si no hay match, el frontend muestra fallback "+").
        icon: iconFromAchievement || null,
      };
    });

    const recentAchievementEvents = achievementsData.map((achievement) => ({
      type: "achievement",
      timestamp: achievement.completed_timestamp,
      achievement: {
        id: achievement.id,
        name: achievement.name,
        description: achievement.description,
        icon: achievement.icon,
        points: achievement.points,
      },
    }));

    const recentMythicEvents = mythicRunsWithAchievementIcons.map((run) => ({
      type: "mythic_plus",
      timestamp: run.completed_timestamp,
      mythicPlus: run,
    }));

    const recentActivity = [...recentAchievementEvents, ...recentMythicEvents]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 12);

    const response = {
      name: characterRes.data.name,
      realmSlug: realm.toLowerCase(),
      level: characterRes.data.level,
      raceId: characterRes.data.race?.id,
      raceName: characterRes.data.race?.name,
      classId: characterRes.data.character_class?.id,
      className: characterRes.data.character_class?.name,
      faction: characterRes.data.faction?.type,
      guild: characterRes.data.guild?.name,
      ilvl: characterRes.data.equipped_item_level,

      media: {
        avatar: mediaMap.avatar,
        inset: mediaMap.inset,
        main: mediaMap["main-raw"],
      },

      achievements: achievementsRes.data.achievements
        .filter((a) => a.completed_timestamp)
        .sort((a, b) => b.completed_timestamp - a.completed_timestamp)
        .slice(0, 5),

      achievementsData: achievementsData,
      mythicPlus: {
        currentRating: mythicPlusData.currentRating,
        recentRuns: mythicRunsWithAchievementIcons,
      },
      recentActivity: recentActivity,
    };

    // Guardar en el caché de personajes
    characterCache[cacheKey] = {
      data: response,
      cachedAt: Date.now(),
    };

    // 👇 NO transformamos nada, lo devolvemos crudo
    res.json(response);
  } catch (error) {
    console.log(error.response?.data || error.message);

    res.status(500).json({
      error: "Error obteniendo personaje",
    });
  }
});

app.post("/cache/warm-guild-achievements", async (req, res) => {
  try {
    const token = await getAccessToken();

    const result = await warmGuildAchievementCache(token, {
      maxMembers: Number(req.query.maxMembers) || 80,
      recentPerCharacter: Number(req.query.recentPerCharacter) || 40,
      onlyKeystoneHeroes: req.query.onlyKeystoneHeroes !== "0",
      scanConcurrency: Number(req.query.scanConcurrency) || 8,
      cacheConcurrency: Number(req.query.cacheConcurrency) || 10,
    });

    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    console.log(error.response?.data || error.message);
    res.status(500).json({
      ok: false,
      error: "No se pudo hacer warm-up del caché de logros",
    });
  }
});

app.post("/cache/warm-guild-achievements/async", async (req, res) => {
  if (warmupState.running) {
    return res.status(409).json({
      ok: false,
      error: "Ya hay un warm-up en ejecución",
      state: warmupState,
    });
  }

  warmupState = {
    running: true,
    startedAt: Date.now(),
    finishedAt: null,
    lastResult: null,
    lastError: null,
  };

  const options = {
    maxMembers: Number(req.query.maxMembers) || 80,
    recentPerCharacter: Number(req.query.recentPerCharacter) || 40,
    onlyKeystoneHeroes: req.query.onlyKeystoneHeroes !== "0",
    scanConcurrency: Number(req.query.scanConcurrency) || 8,
    cacheConcurrency: Number(req.query.cacheConcurrency) || 10,
  };

  res.json({
    ok: true,
    started: true,
    options,
  });

  (async () => {
    try {
      const token = await getAccessToken();
      const result = await warmGuildAchievementCache(token, options);
      warmupState = {
        ...warmupState,
        running: false,
        finishedAt: Date.now(),
        lastResult: result,
      };
    } catch (error) {
      warmupState = {
        ...warmupState,
        running: false,
        finishedAt: Date.now(),
        lastError: error.response?.data || error.message,
      };
      console.log("Warm-up async falló:", error.response?.data || error.message);
    }
  })();
});

app.get("/cache/warm-guild-achievements/status", (req, res) => {
  res.json({
    ok: true,
    state: warmupState,
  });
});
