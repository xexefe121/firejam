import { Rail } from './components/Rail';
import { Prompts, Toasts } from './components/Overlays';
import { Flame } from './components/Icon';
import { scopeRoot, useKeys } from './lib/nav';
import { getState, go, useStore } from './lib/store';
import { Friends } from './screens/Friends';
import { Home } from './screens/Home';
import { Library } from './screens/Library';
import { MapScreen } from './screens/MapScreen';
import { Onboarding } from './screens/Onboarding';
import { Player } from './screens/Player';

export function App() {
  const status = useStore((s) => s.status);
  const screen = useStore((s) => s.screen);
  const online = useStore((s) => s.online);

  // Back from any top-level screen goes Home; Back on Home lets the TV wrapper exit.
  useKeys((key) => {
    if (key !== 'back' || scopeRoot() !== document.body) return false; // an open dialog handles its own Back
    if (getState().screen === 'home' || getState().status !== 'ready') return false;
    go('home');
    return true;
  });

  if (status === 'connecting') {
    return (
      <div className="splash">
        <Flame size="8rem" />
        <p>{online ? 'Lighting the fire…' : 'Connecting to FireJam…'}</p>
      </div>
    );
  }
  if (status === 'onboarding') return <Onboarding />;

  return (
    <div className={`app ${screen === 'player' ? 'fullscreen' : ''}`}>
      {screen !== 'player' && <Rail />}
      <main className="stage" data-group>
        {screen === 'home' && <Home />}
        {screen === 'map' && <MapScreen />}
        {screen === 'friends' && <Friends />}
        {screen === 'library' && <Library />}
        {screen === 'player' && <Player />}
      </main>
      <Toasts />
      <Prompts />
      {!online && <div className="conn-lost">Reconnecting…</div>}
    </div>
  );
}
