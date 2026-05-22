import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";

// Realms WoW US/LATAM pre-guardados (slug -> nombre display)
const WOW_REALMS = [
  { slug: "quelthalas",        name: "Quel'Thalas" },
  { slug: "ragnaros",          name: "Ragnaros" },
  { slug: "dragonmaw",         name: "Dragonmaw" },
  { slug: "maiev",             name: "Maiev" },
  { slug: "azralon",           name: "Azralon" },
  { slug: "gallywix",          name: "Gallywix" },
  { slug: "nemesis",           name: "Nemesis" },
  { slug: "tol-barad",         name: "Tol Barad" },
  { slug: "goldrinn",          name: "Goldrinn" },
  { slug: "illidan",           name: "Illidan" },
  { slug: "area-52",           name: "Area 52" },
  { slug: "stormrage",         name: "Stormrage" },
  { slug: "bleeding-hollow",   name: "Bleeding Hollow" },
  { slug: "moon-guard",        name: "Moon Guard" },
  { slug: "sargeras",          name: "Sargeras" },
  { slug: "thrall",            name: "Thrall" },
  { slug: "zul-jin",           name: "Zul'jin" },
  { slug: "proudmoore",        name: "Proudmoore" },
  { slug: "kil-jaeden",        name: "Kil'jaeden" },
  { slug: "mal-ganis",         name: "Mal'Ganis" },
  { slug: "tichondrius",       name: "Tichondrius" },
];

function FrontPage() {
  const [mode, setMode]               = useState("character");
  const [query, setQuery]             = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSugg, setLoadingSugg] = useState(false);
  const [showRealm, setShowRealm]     = useState(false);
  const [realmSearch, setRealmSearch] = useState("");
  const [focused, setFocused]         = useState(false);
  const [error, setError]             = useState("");

  const navigate    = useNavigate();
  const wrapperRef  = useRef(null);
  const debounceRef = useRef(null);

  // Cierra dropdown al hacer click afuera
  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Busca sugerencias en el backend con debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.trim().length < 2) {
      setSuggestions([]);
      setShowRealm(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoadingSugg(true);
      try {
        const res = await fetch(
          `http://localhost:3000/search?q=${encodeURIComponent(query.trim())}&mode=${mode}`
        );
        const data = await res.json();
        setSuggestions(data.results || []);
        setShowRealm((data.results || []).length === 0);
      } catch {
        setSuggestions([]);
        setShowRealm(true);
      } finally {
        setLoadingSugg(false);
      }
    }, 300);
  }, [query, mode]);

  function handleSelect(result) {
    setFocused(false);
    setQuery("");
    setSuggestions([]);
    setShowRealm(false);
    if (mode === "character") {
      navigate(`/character/${result.realm}/${result.name.toLowerCase()}`);
    } else {
      navigate(`/guild/${result.realm}/${result.name.toLowerCase()}`);
    }
  }

  function handleRealmSelect(realmSlug) {
    const cleanName = query.trim().toLowerCase();
    if (!cleanName) {
      setError("Escribe un nombre primero.");
      return;
    }
    setFocused(false);
    setQuery("");
    setShowRealm(false);
    setRealmSearch("");
    if (mode === "character") {
      navigate(`/character/${realmSlug}/${cleanName}`);
    } else {
      navigate(`/guild/${realmSlug}/${cleanName}`);
    }
  }

  function handleModeChange(newMode) {
    setMode(newMode);
    setQuery("");
    setSuggestions([]);
    setShowRealm(false);
    setRealmSearch("");
    setError("");
  }

  const filteredRealms = realmSearch
    ? WOW_REALMS.filter((r) =>
        r.name.toLowerCase().includes(realmSearch.toLowerCase()) ||
        r.slug.includes(realmSearch.toLowerCase())
      )
    : WOW_REALMS;

  const showDropdown = focused && query.trim().length >= 2;

  return (
    <div className="frontpage">
      <div className="frontpage-hero">
        <h1 className="frontpage-title">Social WoW</h1>
        <p className="frontpage-subtitle">La red social de Azeroth</p>

        <div className="frontpage-toggle">
          <button
            className={`toggle-btn ${mode === "character" ? "active" : ""}`}
            onClick={() => handleModeChange("character")}
          >
            Personaje
          </button>
          <button
            className={`toggle-btn ${mode === "guild" ? "active" : ""}`}
            onClick={() => handleModeChange("guild")}
          >
            Guild
          </button>
        </div>

        <div className="search-wrapper frontpage-search" ref={wrapperRef}>
          <div className="search-input-row">
            <svg className="search-icon" viewBox="0 0 20 20" fill="none">
              <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
              <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              className="search-input"
              type="text"
              placeholder={mode === "character" ? "Buscar personaje..." : "Buscar guild..."}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setError(""); }}
              onFocus={() => setFocused(true)}
              autoComplete="off"
              spellCheck="false"
            />
            {query && (
              <button
                className="search-clear"
                onClick={() => {
                  setQuery("");
                  setSuggestions([]);
                  setShowRealm(false);
                  setRealmSearch("");
                  setError("");
                }}
              >
                ✕
              </button>
            )}
          </div>

          {showDropdown && (
            <div className="search-results">
              {loadingSugg && (
                <div className="search-result-card search-result-card--info">
                  <span className="search-result-name">Buscando...</span>
                </div>
              )}

              {!loadingSugg && suggestions.length > 0 &&
                suggestions.map((result, i) => (
                  <button
                    key={`${result.realm}-${result.name}-${i}`}
                    className="search-result-card"
                    onClick={() => handleSelect(result)}
                  >
                    <span
                      className="search-result-name"
                      style={result.classColor ? { color: result.classColor } : {}}
                    >
                      {result.name}
                    </span>
                    <div className="search-result-meta">
                      {result.className && (
                        <>
                          <span className="search-result-class">{result.className}</span>
                          <span className="search-result-dot">·</span>
                        </>
                      )}
                      <span className="search-result-realm">{result.realm}</span>
                      {result.level && (
                        <>
                          <span className="search-result-dot">·</span>
                          <span className="search-result-level">Nv. {result.level}</span>
                        </>
                      )}
                    </div>
                  </button>
                ))
              }

              {!loadingSugg && showRealm && (
                <div className="search-realm-fallback">
                  <p className="search-realm-label">
                    No encontrado en caché. Elige el realm:
                  </p>
                  <input
                    className="search-input search-realm-filter"
                    type="text"
                    placeholder="Filtrar realm..."
                    value={realmSearch}
                    onChange={(e) => setRealmSearch(e.target.value)}
                    autoComplete="off"
                  />
                  <div className="search-realm-list">
                    {filteredRealms.map((realm) => (
                      <button
                        key={realm.slug}
                        className="search-result-card"
                        onClick={() => handleRealmSelect(realm.slug)}
                      >
                        <span className="search-result-name">{realm.name}</span>
                        <span className="search-result-meta search-result-realm">
                          {realm.slug}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {error && <p className="frontpage-error">{error}</p>}
      </div>
    </div>
  );
}

export default FrontPage;
