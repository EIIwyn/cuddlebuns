import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { translations, getCommissions, shuffleArray } from '../translations';
import { LoadingScreen } from '../components/LoadingScreen';
import { ErrorScreen } from '../components/ErrorScreen';
import { CharacterButton } from '../components/CharacterButton';
import { VersionSelector } from '../components/VersionSelector';
import { SocialLinks } from '../components/SocialLinks';
import { ReferenceSheet } from '../components/ReferenceSheet';
import { CommissionsGrid } from '../components/CommissionsGrid';
import { Lightbox } from '../components/Lightbox';

export function Gallery() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [characters, setCharacters] = useState([]);
  const [selectedChar, setSelectedChar] = useState(null);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [showCommissions, setShowCommissions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [language, setLanguage] = useState('en');
  const [sortOrder, setSortOrder] = useState('random');
  const [refSheetIndex, setRefSheetIndex] = useState(0);
  const [showHiatus, setShowHiatus] = useState(false);

  // Lightbox state
  const [lightboxImage, setLightboxImage] = useState(null);
  const [lightboxInfo, setLightboxInfo] = useState(null);
  const [lightboxIsRefSheet, setLightboxIsRefSheet] = useState(false);
  const [lightboxVersionName, setLightboxVersionName] = useState(null);
  const [lightboxRefSheetIndex, setLightboxRefSheetIndex] = useState(0);

  const t = translations[language];

  // Load characters data
  useEffect(() => {
    fetch('/data/characters.json')
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        setCharacters(data.characters);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load characters:', err);
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // Handle URL parameters on initial load
  useEffect(() => {
    if (characters.length === 0) return;

    const characterParam = searchParams.get('character');
    const versionParam = searchParams.get('version');

    if (characterParam) {
      // Try to find by slug (name converted to lowercase-kebab-case) or by ID
      const character = characters.find(c => {
        const slug = c.name.toLowerCase().replace(/\s+/g, '-');
        return slug === characterParam || c.id.toString() === characterParam;
      });

      if (character) {
        // Setting state here is intentional - we're syncing with URL parameters
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedChar(character);
        setShowCommissions(false);
        setRefSheetIndex(0);

        // Find and set the version
        if (versionParam && character.versions) {
          const version = character.versions.find(v => {
            const versionSlug = v.name.toLowerCase().replace(/\s+/g, '-');
            return versionSlug === versionParam || v.name === versionParam || v.id === versionParam;
          });
          if (version) {
            setSelectedVersion(version);
          } else if (character.versions.length > 0) {
            setSelectedVersion(character.versions[0]);
          }
        } else if (character.versions && character.versions.length > 0) {
          setSelectedVersion(character.versions[0]);
        } else {
          setSelectedVersion(null);
        }
      }
    }
  }, [characters, searchParams]);

  // Handle character selection
  const handleCharacterSelect = (character) => {
    setSelectedChar(character);
    setShowCommissions(false);
    setRefSheetIndex(0);

    let newVersion = null;
    if (character.versions && character.versions.length > 0) {
      newVersion = character.versions[0];
      setSelectedVersion(newVersion);
    } else {
      setSelectedVersion(null);
    }

    // Update URL parameters using slug
    const newParams = new URLSearchParams();
    const characterSlug = character.name.toLowerCase().replace(/\s+/g, '-');
    newParams.set('character', characterSlug);
    if (newVersion) {
      const versionSlug = newVersion.name.toLowerCase().replace(/\s+/g, '-');
      newParams.set('version', versionSlug);
    }
    setSearchParams(newParams);
  };

  // Handle version selection
  const handleVersionSelect = (version) => {
    setSelectedVersion(version);
    setRefSheetIndex(0);

    // Update URL parameters using slug
    if (selectedChar) {
      const newParams = new URLSearchParams();
      const characterSlug = selectedChar.name.toLowerCase().replace(/\s+/g, '-');
      const versionSlug = version.name.toLowerCase().replace(/\s+/g, '-');
      newParams.set('character', characterSlug);
      newParams.set('version', versionSlug);
      setSearchParams(newParams);
    }
  };

  // Toggle language
  const toggleLanguage = () => {
    setLanguage(lang => lang === 'en' ? 'ja' : 'en');
  };

  // Handle lightbox open
  const handleImageClick = (image, commission, isRefSheet, versionName = null, refSheets = null, index = 0) => {
    setLightboxImage(image);
    setLightboxInfo(commission || { refSheets });
    setLightboxIsRefSheet(isRefSheet);
    setLightboxVersionName(versionName);
    setLightboxRefSheetIndex(index);
  };

  // Handle lightbox close
  const handleLightboxClose = () => {
    setLightboxImage(null);
    setLightboxInfo(null);
  };

  // Get commissions for selected character/version - memoized to prevent unnecessary recalculations
  const commissions = useMemo(() => {
    if (selectedChar && selectedVersion) {
      return getCommissions(selectedChar, selectedVersion);
    }
    return [];
  }, [selectedChar, selectedVersion]);

  // Sort commissions - memoize to prevent re-shuffling on every render
  const sortedCommissions = useMemo(() => {
    if (sortOrder === 'random') {
      return shuffleArray(commissions);
    }
    return [...commissions].reverse();
  }, [commissions, sortOrder]);

  // Check if reference sheet exists
  const hasRefSheet = selectedChar && selectedVersion && (
    (selectedVersion?.refSheets && selectedVersion.refSheets.length > 0) ||
    selectedVersion?.refSheet ||
    (selectedChar.refSheets && selectedChar.refSheets.length > 0) ||
    selectedChar.refSheet
  );

  if (loading) {
    return <LoadingScreen lang={language} />;
  }

  if (error) {
    return <ErrorScreen message={error} lang={language} />;
  }

  return (
    <div className="gallery-container">
      {/* Decorative Background */}
      {selectedChar && (
        <div className="bg-decorations">
          <div
            className="bg-glow bg-glow--top"
            style={{
              background: `radial-gradient(circle, ${selectedChar.color}25 0%, transparent 70%)`
            }}
          />
          <div
            className="bg-glow bg-glow--bottom"
            style={{
              background: `radial-gradient(circle, ${selectedChar.color}15 0%, transparent 70%)`
            }}
          />
        </div>
      )}

      <div className="gallery-content">
        {/* Header */}
        <header className="gallery-header">
          <h1 className="gallery-title">{t.galleryTitle}</h1>
          <button
            className="lang-switch"
            onClick={toggleLanguage}
            aria-label="Toggle language"
          >
            {language === 'en' ? '日本語' : 'English'}
          </button>
        </header>

        {/* Character Selection */}
        {(() => {
          const activeChars = characters.filter(c => c.status !== 'hiatus');
          const hiatusChars = characters.filter(c => c.status === 'hiatus');
          const mainChars = activeChars.filter(c => c.group !== 'etc');
          const etcChars = activeChars.filter(c => c.group === 'etc');
          return (
            <div className="character-nav-wrapper">
              <div className="character-nav-row">
                <nav className="character-nav">
                  {mainChars.map(character => (
                    <CharacterButton
                      key={character.id}
                      character={character}
                      isSelected={selectedChar?.id === character.id}
                      onClick={() => handleCharacterSelect(character)}
                      lang={language}
                    />
                  ))}
                </nav>
                {etcChars.length > 0 && (
                  <nav className="character-nav character-nav--etc">
                    {etcChars.map(character => (
                      <CharacterButton
                        key={character.id}
                        character={character}
                        isSelected={selectedChar?.id === character.id}
                        onClick={() => handleCharacterSelect(character)}
                        lang={language}
                      />
                    ))}
                  </nav>
                )}
              </div>
              {hiatusChars.length > 0 && (
                <div className="hiatus-section">
                  <button
                    className="hiatus-toggle"
                    onClick={() => setShowHiatus(h => !h)}
                  >
                    <span className="hiatus-toggle__icon">{showHiatus ? '▲' : '▼'}</span>
                    {showHiatus ? t.hideHiatus : `${t.showHiatus} (${hiatusChars.length})`}
                  </button>
                  {showHiatus && (
                    <nav className="character-nav character-nav--hiatus">
                      {hiatusChars.map(character => (
                        <CharacterButton
                          key={character.id}
                          character={character}
                          isSelected={selectedChar?.id === character.id}
                          onClick={() => handleCharacterSelect(character)}
                          lang={language}
                        />
                      ))}
                    </nav>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* Main Content */}
        {!selectedChar ? (
          <div className="content-card">
            <div className="character-select-prompt">
              <p className="character-select-prompt__text">
                {t.selectCharacter[0]}
                <br />
                {t.selectCharacter[1]}
              </p>
            </div>
          </div>
        ) : (
          <div className="content-card">
            {/* Version Selector */}
            {selectedChar.versions && selectedChar.versions.length > 1 && (
              <VersionSelector
                versions={selectedChar.versions}
                selectedVersion={selectedVersion}
                onSelectVersion={handleVersionSelect}
                accentColor={selectedChar.color}
              />
            )}

            {/* Social Links */}
            <SocialLinks character={selectedChar} />

            {/* Toggle Button - only show if there's a reference sheet */}
            {hasRefSheet && (
              <div className="toggle-container">
                <button
                  className="toggle-btn"
                  style={{
                    background: showCommissions
                      ? `linear-gradient(135deg, ${selectedChar.color}, ${selectedChar.color}cc)`
                      : 'transparent',
                    borderColor: selectedChar.color,
                    color: showCommissions ? '#fff' : selectedChar.color,
                    boxShadow: 'none',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = `0 8px 24px ${selectedChar.color}40`;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                  onClick={() => setShowCommissions(!showCommissions)}
                >
                  <span className="toggle-btn__icon">
                    {showCommissions ? '◀' : '▶'}
                  </span>
                  {showCommissions
                    ? t.viewRefSheet
                    : `${t.viewCommissions} (${commissions.length})`
                  }
                </button>
              </div>
            )}

            {/* Reference Sheet or Commissions */}
            {!showCommissions && hasRefSheet ? (
              <ReferenceSheet
                character={selectedChar}
                selectedVersion={selectedVersion}
                onImageClick={handleImageClick}
                currentIndex={refSheetIndex}
                onIndexChange={setRefSheetIndex}
                lang={language}
              />
            ) : showCommissions || !hasRefSheet ? (
              <CommissionsGrid
                character={selectedChar}
                commissions={sortedCommissions}
                versionName={selectedVersion?.name}
                onImageClick={handleImageClick}
                sortOrder={sortOrder}
                onSortChange={setSortOrder}
                lang={language}
              />
            ) : null}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxImage && (
        <Lightbox
          image={lightboxImage}
          info={lightboxInfo}
          character={selectedChar}
          isRefSheet={lightboxIsRefSheet}
          versionName={lightboxVersionName}
          onClose={handleLightboxClose}
          currentIndex={lightboxRefSheetIndex}
          onIndexChange={setLightboxRefSheetIndex}
          lang={language}
        />
      )}
    </div>
  );
}

// Exported as named export above
