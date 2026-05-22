import { useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { CLASS_NAMES, RACE_NAMES } from "./wow_id";

function CharacterPage() {
  const { realm, name } = useParams();
  const [character, setCharacter] = useState(null);
  const [error, setError] = useState(null);
  const cleanName = name.toLowerCase();
  const cleanRealm = realm.toLowerCase();
  const classNames = CLASS_NAMES;
  const raceNames = RACE_NAMES;

  useEffect(() => {
    setError(null);
    fetch(`http://localhost:3000/character/${cleanRealm}/${cleanName}?refresh=1`, {
      cache: "no-store",
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error("No se pudo cargar el personaje");
        }
        return res.json();
      })
      .then((data) => {
        console.log("CHARACTER DATA:", data);
        setCharacter(data);
      })
      .catch((err) => {
        setError(err.message);
      });
  }, [cleanRealm, cleanName]);

  if (error) {
    return <h2>{error}</h2>;
  }

  if (!character) {
    return <h2>Cargando personaje...</h2>;
  }

  const recentActivity = character.recentActivity || [];
  const className =
    character.className ||
    classNames[character.classId] ||
    `Class ${character.classId ?? "N/A"}`;
  const raceName =
    character.raceName ||
    raceNames[character.raceId]?.name ||
    `Race ${character.raceId ?? "N/A"}`;

  return (
    <div className="character-page">
      <div className="activity-section">
        <h2>Actividad Reciente</h2>
        <div className="activity-feed">
          {recentActivity.length === 0 && (
            <div className="activity-card">
              <div className="activity-info">
                <span className="activity-name">Sin actividad reciente</span>
              </div>
            </div>
          )}

          {recentActivity.map((event, index) => {
            const eventDate = new Date(event.timestamp).toLocaleString("es-MX");

            if (event.type === "mythic_plus") {
              return (
                <div
                  key={`mplus-${event.timestamp}-${index}`}
                  className="activity-card"
                >
                  {event.mythicPlus.icon ? (
                    <img
                      src={event.mythicPlus.icon}
                      className="achievement-icon"
                      alt={event.mythicPlus.dungeon}
                    />
                  ) : (
                    <div className="activity-icon activity-icon--mplus">+</div>
                  )}
                  <div className="activity-info">
                    <span className="activity-name">
                      M+ {event.mythicPlus.dungeon} +{event.mythicPlus.keystone_level}
                    </span>
                    <span className="activity-date">{eventDate}</span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={`achievement-${event.achievement.id}-${event.timestamp}`}
                className="activity-card"
              >
                <img src={event.achievement.icon} className="achievement-icon" />
                <div className="activity-info">
                  <span className="activity-name">{event.achievement.name}</span>
                  <span className="activity-description">
                    {event.achievement.description}
                  </span>
                  <span className="activity-date">{eventDate}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="character-card">
        <h1>{character.name}</h1>
        <p>
          {className} {raceName}
        </p>
        <p>{character.guild}</p>
        <img
          src={character.media.main}
          className="character-image"
          alt={character.name}
        />
        <div className="character-stats">
          <span className="character-level">Nivel {character.level}</span>
          <span className="character-ilvl">ILvl: {character.ilvl}</span>
          {character.mythicPlus?.currentRating && (
            <span className="character-ilvl">
              M+ Score: {Math.round(character.mythicPlus.currentRating)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default CharacterPage;
