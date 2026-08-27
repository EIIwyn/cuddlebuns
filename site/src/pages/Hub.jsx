import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorScreen } from '../components/ErrorScreen';
import { LoadingScreen } from '../components/LoadingScreen';
import { ModernImage } from '../components/ModernImage';
import { SiteNav } from '../components/SiteNav';

function characterVersion(character) {
  return character.versions.find((version) => version.referenceSheets?.length) || character.versions[0];
}

function characterUrl(character) {
  const version = characterVersion(character);
  const params = new URLSearchParams({ character: character.slug });
  if (version) params.set('version', version.slug);
  return `/gallery?${params}`;
}

function categoryLabel(collection) {
  if (collection.slug === 'oc') return 'Original character';
  if (collection.slug === 'archive') return 'Archived';
  return collection.name;
}

function CharacterLink({ entry }) {
  const thumbnail = characterVersion(entry.character)?.referenceSheets?.[0];

  return (
    <article className="character-link" style={{ '--accent': entry.character.color }}>
      <Link to={characterUrl(entry.character)}>
        <span className="character-link__copy">
          <strong>{entry.character.name}</strong>
          <small>{entry.character.subtitle || categoryLabel(entry.collection)}</small>
        </span>
        <span className={`character-link__thumbnail${thumbnail ? '' : ' character-link__thumbnail--empty'}`} aria-hidden="true">
          {thumbnail && (
            <ModernImage
              src={thumbnail}
              alt=""
              sizes="120px"
            />
          )}
        </span>
      </Link>
    </article>
  );
}

export function Hub() {
  const [site, setSite] = useState(null);
  const [error, setError] = useState(null);
  const [activeCollection, setActiveCollection] = useState('all');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/data/cms/site.json', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(setSite)
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message);
      });
    return () => controller.abort();
  }, []);

  const collections = useMemo(
    () => site?.collections ?? [],
    [site],
  );
  const cast = useMemo(() => collections
    .filter((collection) => activeCollection === 'all'
      ? collection.slug !== 'archive'
      : collection.slug === activeCollection)
    .flatMap((collection) =>
      collection.characters.map((character) => ({ character, collection }))),
  [activeCollection, collections]);

  if (error) return <ErrorScreen message={error} artifact="data/cms/site.json" />;
  if (!site) return <LoadingScreen />;

  return (
    <div className="site-shell">
      <SiteNav />
      <main className="home-index page-width">
        <h1 className="visually-hidden">Characters</h1>

        <nav className="collection-nav" aria-label="Character categories">
          <button
            className={activeCollection === 'all' ? 'is-active' : ''}
            onClick={() => setActiveCollection('all')}
            aria-pressed={activeCollection === 'all'}
          >
            All
          </button>
          {collections.map((collection) => (
            <button
              key={collection.id}
              className={activeCollection === collection.slug ? 'is-active' : ''}
              onClick={() => setActiveCollection(collection.slug)}
              aria-pressed={activeCollection === collection.slug}
            >
              {categoryLabel(collection)}
            </button>
          ))}
        </nav>

        {cast.length > 0 && (
          <section className="character-link-grid" aria-label="Character index">
            {cast.map((entry) => (
              <CharacterLink key={entry.character.id} entry={entry} />
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
