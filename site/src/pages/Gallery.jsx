import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CharacterButton } from '../components/CharacterButton';
import { CommissionsGrid } from '../components/CommissionsGrid';
import { ErrorScreen } from '../components/ErrorScreen';
import { Lightbox } from '../components/Lightbox';
import { LoadingScreen } from '../components/LoadingScreen';
import { ModernImage } from '../components/ModernImage';
import { VersionSelector } from '../components/VersionSelector';
import { shuffleArray } from '../translations';

function initialBatchSize() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches ? 12 : 24;
}

export function Gallery() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [site, setSite] = useState(null);
  const [gallery, setGallery] = useState(null);
  const [siteError, setSiteError] = useState(null);
  const [galleryError, setGalleryError] = useState(null);
  const [sortOrder, setSortOrder] = useState('recency');
  const [visibleCount, setVisibleCount] = useState(initialBatchSize);
  const [openCollections, setOpenCollections] = useState(() => new Set());
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/data/cms/site.json', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(setSite)
      .catch((error) => {
        if (error.name !== 'AbortError') setSiteError(error.message);
      });
    return () => controller.abort();
  }, []);

  const characters = useMemo(
    () => site?.collections.flatMap((collection) => collection.characters) ?? [],
    [site],
  );
  const selectedCharacter = useMemo(() => {
    const slug = searchParams.get('character');
    return characters.find((character) => character.slug === slug) || characters[0] || null;
  }, [characters, searchParams]);
  const selectedVersion = useMemo(() => {
    const slug = searchParams.get('version');
    return selectedCharacter?.versions.find((version) => version.slug === slug) ||
      selectedCharacter?.versions[0] || null;
  }, [selectedCharacter, searchParams]);

  useEffect(() => {
    if (!selectedVersion?.galleryUrl) return undefined;
    const controller = new AbortController();
    // A new version intentionally clears the previous version while it loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGallery(null);
    setGalleryError(null);
    fetch(selectedVersion.galleryUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(setGallery)
      .catch((error) => {
        if (error.name !== 'AbortError') setGalleryError(error.message);
      });
    return () => controller.abort();
  }, [selectedVersion?.galleryUrl]);

  const commissions = useMemo(() => {
    const items = gallery?.commissions ?? [];
    return sortOrder === 'random'
      ? shuffleArray(items)
      : [...items].sort((left, right) =>
          String(right.date ?? '').localeCompare(String(left.date ?? '')) ||
          Number(left.displayOrder ?? 0) - Number(right.displayOrder ?? 0),
        );
  }, [gallery, sortOrder]);
  const visibleCommissions = commissions.slice(0, visibleCount);

  const chooseCharacter = (character) => {
    const params = new URLSearchParams();
    params.set('character', character.slug);
    if (character.versions[0]) params.set('version', character.versions[0].slug);
    setVisibleCount(initialBatchSize());
    setSearchParams(params);
  };
  const chooseVersion = (version) => {
    setVisibleCount(initialBatchSize());
    setSearchParams({ character: selectedCharacter.slug, version: version.slug });
  };
  const toggleCollection = (collectionId) => {
    setOpenCollections((current) => {
      const next = new Set(current);
      if (next.has(collectionId)) next.delete(collectionId);
      else next.add(collectionId);
      return next;
    });
  };

  if (siteError) return <ErrorScreen message={siteError} artifact="data/cms/site.json" lang="en" />;
  if (!site) return <LoadingScreen lang="en" />;
  if (!selectedCharacter || !selectedVersion) {
    return <ErrorScreen message="No visible character versions were generated." artifact="data/cms/site.json" lang="en" />;
  }

  return (
    <div className="gallery-container noco-gallery">
      <div className="bg-decorations">
        <div
          className="bg-glow bg-glow--top"
          style={{ background: `radial-gradient(circle, ${selectedCharacter.color}25 0%, transparent 70%)` }}
        />
      </div>

      <div className="gallery-content">
        <header className="gallery-header">
          <h1 className="gallery-title">Character Gallery</h1>
          <p className="noco-gallery-status">Published from NocoDB · optimized and served statically</p>
        </header>

        <div className="noco-collection-list" aria-label="Character collections">
          {site.collections.map((collection) => {
            const isOpen = !collection.collapsible || openCollections.has(collection.id);
            return (
              <section className="noco-collection" key={collection.id}>
                {collection.collapsible ? (
                  <button
                    className="noco-collection__toggle"
                    onClick={() => toggleCollection(collection.id)}
                    aria-expanded={isOpen}
                  >
                    <span>{collection.name}</span>
                    <span>{isOpen ? '−' : '+'}</span>
                  </button>
                ) : <h2 className="noco-collection__title">{collection.name}</h2>}
                {isOpen && (
                  <nav className="noco-character-nav">
                    {collection.characters.map((character) => (
                      <CharacterButton
                        key={character.id}
                        character={character}
                        isSelected={selectedCharacter.id === character.id}
                        onClick={() => chooseCharacter(character)}
                        lang="en"
                      />
                    ))}
                  </nav>
                )}
              </section>
            );
          })}
        </div>

        <div className="content-card">
          <div className="noco-character-heading">
            <div>
              <h2>{selectedCharacter.name}</h2>
              {selectedCharacter.subtitle && <p>{selectedCharacter.subtitle}</p>}
            </div>
            {selectedCharacter.social && (
              <a href={selectedCharacter.social.url} target="_blank" rel="noreferrer" className="social-link-btn">
                {selectedCharacter.social.label}
              </a>
            )}
          </div>

          <VersionSelector
            versions={selectedCharacter.versions}
            selectedVersion={selectedVersion}
            onSelectVersion={chooseVersion}
            accentColor={selectedCharacter.color}
          />

          {selectedVersion.referenceSheets.length > 0 && (
            <section className="noco-reference-section">
              <h3>Reference sheets</h3>
              <div className="noco-reference-strip">
                {selectedVersion.referenceSheets.map((image, index) => (
                  <button
                    key={image.fallback.url}
                    className="noco-reference-card"
                    onClick={() => setLightbox({
                      image,
                      info: { refSheets: selectedVersion.referenceSheets },
                      isRefSheet: true,
                      index,
                    })}
                  >
                    <ModernImage src={image} alt={`${selectedCharacter.name} reference sheet ${index + 1}`} />
                  </button>
                ))}
              </div>
            </section>
          )}

          {galleryError ? (
            <ErrorScreen message={galleryError} artifact={selectedVersion.galleryUrl} lang="en" />
          ) : !gallery ? (
            <LoadingScreen lang="en" />
          ) : (
            <>
              <CommissionsGrid
                character={selectedCharacter}
                commissions={visibleCommissions}
                versionName={selectedVersion.name}
                onImageClick={(image, commission) => setLightbox({ image, info: commission, isRefSheet: false, index: 0 })}
                sortOrder={sortOrder}
                onSortChange={(order) => {
                  setSortOrder(order);
                  setVisibleCount(initialBatchSize());
                }}
                lang="en"
              />
              {visibleCount < commissions.length && (
                <div className="noco-show-more">
                  <button onClick={() => setVisibleCount((count) => count + initialBatchSize())}>
                    Show more ({commissions.length - visibleCount} remaining)
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {lightbox && (
        <Lightbox
          image={lightbox.image}
          info={lightbox.info}
          character={selectedCharacter}
          isRefSheet={lightbox.isRefSheet}
          versionName={selectedVersion.name}
          onClose={() => setLightbox(null)}
          currentIndex={lightbox.index}
          lang="en"
        />
      )}
    </div>
  );
}
