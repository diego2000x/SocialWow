import { useEffect, useState, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { CLASS_NAMES, RACE_NAMES, CLASS_COLORS } from "./wow_id";

function GuildList() {
  const { realm, guildName } = useParams();
  const [members, setMembers] = useState([]);
  const [guild, setGuild] = useState({});
  const [error, setError] = useState(null);
  const classNames  = CLASS_NAMES;
  const classColors = CLASS_COLORS;
  const [busqueda, setBusqueda] = useState("");
  const [focused, setFocused]   = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    setError(null);
    setMembers([]);
    setGuild({});

    fetch(`http://localhost:3000/guild/${realm}/${guildName}`)
      .then((response) => {
        if (!response.ok) throw new Error("No se pudo cargar la guild");
        return response.json();
      })
      .then((data) => {
        setMembers(data.members);
        setGuild(data.guild);
      })
      .catch((err) => setError(err.message));
  }, [realm, guildName]);

  // Cierra los resultados al hacer click afuera
  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (error) return <h2>{error}</h2>;
  if (!members.length) return <h2>Cargando guild...</h2>;

  const resultados = busqueda
    ? members
        .filter((member) =>
          member.character.name.toLowerCase().includes(busqueda.toLowerCase())
        )
        .slice(0, 5)
    : [];

  return (
    <div className="guild-list-wrapper">
      <h1>
        Miembros Guild <span>{guild.name}</span>
      </h1>

      {/* ── Buscador ── */}
      <div className="search-wrapper" ref={wrapperRef}>
        <div className="search-input-row">
          <svg className="search-icon" viewBox="0 0 20 20" fill="none">
            <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M13.5 13.5L17 17"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <input
            className="search-input"
            type="text"
            placeholder="Buscar personaje..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onFocus={() => setFocused(true)}
          />
          {busqueda && (
            <button className="search-clear" onClick={() => setBusqueda("")}>
              ✕
            </button>
          )}
        </div>

        {/* ── Dropdown de resultados ── */}
        {focused && resultados.length > 0 && (
          <div className="search-results">
            {resultados.map((member) => {
              const classId = member.character.playable_class.id;
              return (
                <Link
                  key={member.character.id}
                  className="search-result-card"
                  to={`/character/${member.character.realm.slug}/${member.character.name}`}
                  onClick={() => {
                    setBusqueda("");
                    setFocused(false);
                  }}
                >
                  <span
                    className="search-result-name"
                    style={{ color: classColors[classId] }}
                  >
                    {member.character.name}
                  </span>
                  <div className="search-result-meta">
                    <span className="search-result-class">{classNames[classId]}</span>
                    <span className="search-result-dot">·</span>
                    <span className="search-result-realm">{member.character.realm.slug}</span>
                    <span className="search-result-dot">·</span>
                    <span className="search-result-level">Nv. {member.character.level}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {focused && busqueda && resultados.length === 0 && (
          <div className="search-results search-results--empty">
            <span>
              Sin resultados para "<strong>{busqueda}</strong>"
            </span>
          </div>
        )}
      </div>

      <table className="guild-table">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Clase</th>
            <th>Nivel</th>
            <th>Realm</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const classId = member.character.playable_class.id;
            return (
              <tr key={member.character.id}>
                <td style={{ color: classColors[classId], fontWeight: "bold" }}>
                  <Link
                    className="character-link"
                    to={`/character/${member.character.realm.slug}/${member.character.name}`}
                  >
                    {member.character.name}
                  </Link>
                </td>
                <td>{classNames[classId]}</td>
                <td>{member.character.level}</td>
                <td>{member.character.realm.slug}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default GuildList;
