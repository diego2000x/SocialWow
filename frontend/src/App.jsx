import GuildList from "./GuildList";
import CharacterPage from "./CharacterPage";
import FrontPage from "./FrontPage";

import wowLogo from "./assets/wow_icon.png";

import { Routes, Route, Link } from "react-router-dom";

function App() {
  return (
    <>
      <Link to="/" className="app_title">
        <img src={wowLogo} alt="Wow Logo" />
        Wow Social
      </Link>

      <Routes>
        <Route path="/" element={<FrontPage />} />
        <Route path="/guild/:realm/:guildName" element={<GuildList />} />
        <Route path="/character/:realm/:name" element={<CharacterPage />} />
      </Routes>
    </>
  );
}

export default App;
