import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CommissionsGrid } from '../components/CommissionsGrid';
import { ErrorScreen } from '../components/ErrorScreen';
import { Lightbox } from '../components/Lightbox';
import { LoadingScreen } from '../components/LoadingScreen';
import { ModernImage } from '../components/ModernImage';
import { SiteNav } from '../components/SiteNav';
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
    if (!slug) return null;
    return characters.find((character) => character.slug === slug) || null;
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

  const chooseVersion = (version) => {
    setVisibleCount(initialBatchSize());
    setSearchParams({ character: selectedCharacter.slug, version: version.slug });
  };
  const openReference = (image, index) => setLightbox({
    image,
    info: { refSheets: selectedVersion.referenceSheets },
    isRefSheet: true,
    index,
  });

  if (siteError) return <ErrorScreen message={siteError} artifact="data/cms/site.json" />;
  if (!site) return <LoadingScreen />;
  if (!searchParams.get('character')) {
    return (
      <div className="site-shell">
        <SiteNav />
        <main className="gallery-placeholder page-width">
          <p className="eyebrow">Gallery</p>
          <h1>Commission archive</h1>
          <p>A global artwork browser is being assembled. Individual collections remain available through the cast index.</p>
          <Link to="/">Browse characters →</Link>
        </main>
      </div>
    );
  }
  if (!selectedCharacter || !selectedVersion) {
    return <ErrorScreen message="No visible character versions were generated." artifact="data/cms/site.json" />;
  }

  const referenceSheets = selectedVersion.referenceSheets ?? [];
  const primaryReference = referenceSheets[0];
  const primaryReferenceAspectRatio = Number(primaryReference?.aspectRatio) || 1;
  const primaryReferenceNaturalWidth = primaryReference?.fallback?.width || primaryReference?.width || 1600;
  const referenceLayoutStyle = {
    '--reference-height-width': `${(primaryReferenceAspectRatio * 78).toFixed(2)}vh`,
    '--reference-natural-width': `${primaryReferenceNaturalWidth}px`,
  };

  return (
    <div className="site-shell" style={{ '--accent': selectedCharacter.color }}>
      <SiteNav />
      <main className="character-page page-width">
        <header className="character-masthead">
          <div>
            <h1>{selectedCharacter.name}</h1>
            <div className="character-masthead__details">
              {selectedCharacter.subtitle && <p>{selectedCharacter.subtitle}</p>}
              {selectedCharacter.social && (
                <a
                  className="character-masthead__social"
                  href={selectedCharacter.social.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {selectedCharacter.social.label} ↗
                </a>
              )}
            </div>
          </div>
        </header>

        <VersionSelector
          versions={selectedCharacter.versions}
          selectedVersion={selectedVersion}
          onSelectVersion={chooseVersion}
        />

        {referenceSheets.length > 0 && (
          <section className="reference-section" aria-label={`${selectedCharacter.name} reference artwork`}>
            <div className={[
              'reference-layout',
              referenceSheets.length === 1 ? 'reference-layout--single' : '',
            ].filter(Boolean).join(' ')} style={referenceLayoutStyle}>
              <button
                className="reference-feature"
                onClick={() => openReference(referenceSheets[0], 0)}
                aria-label={`Open ${selectedCharacter.name} reference sheet`}
              >
                <ModernImage
                  src={referenceSheets[0]}
                  alt={`${selectedCharacter.name} reference sheet`}
                  lazy={false}
                  sizes="(max-width: 760px) 100vw, calc(100vw - 300px)"
                />
              </button>

              {referenceSheets.length > 1 && (
                <div className="reference-thumbnails" aria-label="Additional reference sheets">
                  {referenceSheets.slice(1).map((image, offset) => (
                    <button
                      key={image.fallback.url}
                      onClick={() => openReference(image, offset + 1)}
                      aria-label={`Open reference sheet ${offset + 2}`}
                    >
                      <ModernImage
                        src={image}
                        alt={`${selectedCharacter.name} reference sheet ${offset + 2}`}
                        sizes="(max-width: 760px) 30vw, 220px"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {galleryError ? (
          <ErrorScreen message={galleryError} artifact={selectedVersion.galleryUrl} />
        ) : !gallery ? (
          <LoadingScreen />
        ) : (
          <>
            <CommissionsGrid
              commissions={visibleCommissions}
              totalCount={commissions.length}
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
              <div className="show-more">
                <button onClick={() => setVisibleCount((count) => count + initialBatchSize())}>
                  Show {Math.min(initialBatchSize(), commissions.length - visibleCount)} more
                </button>
                <span>{visibleCount} of {commissions.length}</span>
              </div>
            )}
          </>
        )}
      </main>

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
