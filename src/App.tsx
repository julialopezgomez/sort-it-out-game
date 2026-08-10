import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LandingScreen } from './screens/LandingScreen';
import { CreateGameScreen } from './screens/CreateGameScreen';
import { JoinScreen } from './screens/JoinScreen';
import { RoomScreen } from './screens/RoomScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { RulesScreen } from './screens/RulesScreen';
import { UpdatePrompt } from './components/UpdatePrompt';

/**
 * Routing.
 *
 * HashRouter, deliberately: GitHub Pages serves static files with no rewrite rules, so a
 * path like /room/ABCDEF would 404 on refresh. Hash routes survive a reload, a bookmark
 * and a shared link on any static host, with no server configuration at all.
 */
export default function App() {
  return (
    <HashRouter>
      <UpdatePrompt />
      <Routes>
        <Route path="/" element={<LandingScreen />} />
        <Route path="/create" element={<CreateGameScreen />} />
        <Route path="/join" element={<JoinScreen />} />
        <Route path="/join/:code" element={<JoinScreen />} />
        <Route path="/room/:code" element={<RoomScreen />} />
        <Route path="/history" element={<HistoryScreen />} />
        <Route path="/rules" element={<RulesScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
