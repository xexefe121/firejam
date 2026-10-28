import { useRef, useState } from 'react';
import type { Media } from '../../../shared/protocol';
import { MediaCard } from '../components/cards';
import { StartJamSheet } from '../components/sheets';
import { useAutoFocus } from '../lib/nav';
import { useMe, useStore } from '../lib/store';

export function Library() {
  const catalog = useStore((s) => s.catalog);
  const me = useMe();
  const [start, setStart] = useState<Media | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useAutoFocus(ref);

  const prime = catalog.filter((m) => m.provider === 'prime');
  const shows = prime.filter((m) => m.subtitle !== 'Film');
  const films = prime.filter((m) => m.subtitle === 'Film');
  const free = catalog.filter((m) => m.provider === 'firejam');
  // Prime Video first for anyone who has it; without it, those titles are locked, so free films lead.
  const hasPrime = !!me?.user.services.includes('prime');

  const primeSection = (
    <section className="block library-prime" key="prime">
      <h3>
        Watch on Prime Video <span>Everyone in the jam needs Prime Video. Each TV plays it in its own Prime Video app, in step.</span>
      </h3>
      <div className="grid media-grid prime-grid">
        {shows.map((m) => (
          <MediaCard key={m.id} media={m} onSelect={() => setStart(m)} />
        ))}
      </div>
      {films.length > 0 && (
        <>
          <h4 className="sub-head">Films</h4>
          <div className="grid media-grid prime-grid">
            {films.map((m) => (
              <MediaCard key={m.id} media={m} onSelect={() => setStart(m)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
  const freeSection = (
    <section className="block library-free" key="free">
      <h3>
        Free films <span>Streamed by FireJam, no subscription needed.</span>
      </h3>
      <div className="grid media-grid small">
        {free.map((m) => (
          <MediaCard key={m.id} media={m} onSelect={() => setStart(m)} />
        ))}
      </div>
      <p className="credit page-credit">
        Films by the Blender Foundation, shared under Creative Commons Attribution. The same sync works for any player
        that can report and seek its position.
      </p>
    </section>
  );

  return (
    <div className="screen library" ref={ref}>
      <header className="screen-head">
        <div>
          <h1>Start a Jam</h1>
          <p className="muted big">Pick something. Everyone who joins lands on the exact same moment.</p>
        </div>
      </header>
      {hasPrime ? [primeSection, freeSection] : [freeSection, primeSection]}
      {start && <StartJamSheet media={start} onClose={() => setStart(null)} />}
    </div>
  );
}
