import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { translations, getCommissions, shuffleArray, downloadReferenceSheet } from '../translations';
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

  // Expanded sheet state (for reference sheets)
  const [expandedSheet, setExpandedSheet] = useState(null);
  const [expandedSheetIndex, setExpandedSheetIndex] = useState(0);

  // Lightbox state (for commissions)
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

  // Handle image click - inline expansion for ref sheets, lightbox for commissions
  const handleImageClick = (image, commission, isRefSheet, versionName = null, refSheets = null, index = 0) => {
    if (isRefSheet) {
      // Inline expansion for reference sheets
      setExpandedSheet({ refSheets, versionName, character: selectedChar });
      setExpandedSheetIndex(index);
    } else {
      // Lightbox for commissions
      setLightboxImage(image);
      setLightboxInfo(commission);
      setLightboxIsRefSheet(false);
      setLightboxVersionName(versionName);
      setLightboxRefSheetIndex(index);
    }
  };

  // Handle expanded sheet close
  const handleExpandedSheetClose = () => {
    setExpandedSheet(null);
    setExpandedSheetIndex(0);
  };

  // Handle expanded sheet navigation
  const handleExpandedSheetNext = () => {
    if (expandedSheet?.refSheets) {
      setExpandedSheetIndex((i) => (i + 1) % expandedSheet.refSheets.length);
    }
  };

  const handleExpandedSheetPrev = () => {
    if (expandedSheet?.refSheets) {
      setExpandedSheetIndex((i) => (i - 1 + expandedSheet.refSheets.length) % expandedSheet.refSheets.length);
    }
  };

  // Handle expanded sheet download
  const handleExpandedSheetDownload = async () => {
    if (expandedSheet && selectedChar) {
      await downloadReferenceSheet(
        expandedSheet.refSheets[expandedSheetIndex],
        selectedChar.name,
        expandedSheet.versionName,
        expandedSheetIndex,
        expandedSheet.refSheets.length
      );
    }
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
          const mainRows = [
            activeChars.filter(c => c.name === 'OC'),
            activeChars.filter(c => ['Touhou', 'UmaMusume', 'Miscellaneous'].includes(c.name)),
            activeChars.filter(c => ['Ryenna', 'Ame Okashi', 'Elise Thornheart', 'Nynx Omnia'].includes(c.name))
          ].filter(row => row.length > 0);
          return (
            <div className="character-nav-wrapper">
              <div className="character-nav-row">
                {mainRows.map((row, rowIndex) => (
                  <nav
                    key={`row-${rowIndex}`}
                    className={`character-nav character-nav--row character-nav--row-${rowIndex + 1}`}
                  >
                    {row.map(character => (
                      <CharacterButton
                        key={character.id}
                        character={character}
                        isSelected={selectedChar?.id === character.id}
                        onClick={() => handleCharacterSelect(character)}
                        lang={language}
                      />
                    ))}
                  </nav>
                ))}
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

      {/* Expanded Sheet View - only for reference sheets */}
      {expandedSheet && (
        <div className="expanded-sheet-overlay" onClick={handleExpandedSheetClose}>
          <button className="expanded-sheet-close" onClick={handleExpandedSheetClose}>✕</button>
          <div className="expanded-sheet-container" onClick={(e) => e.stopPropagation()}>
            <img
              src={expandedSheet.refSheets[expandedSheetIndex]}
              alt={`${expandedSheet.character.name} Reference Sheet ${expandedSheetIndex + 1}`}
              className="expanded-sheet-image"
            />
            {expandedSheet.refSheets.length > 1 && (
              <>
                <button
                  className="expanded-sheet-nav expanded-sheet-nav--prev"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExpandedSheetPrev();
                  }}
                  aria-label={t.previousRefSheet}
                >
                  ‹
                </button>
                <button
                  className="expanded-sheet-nav expanded-sheet-nav--next"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleExpandedSheetNext();
                  }}
                  aria-label={t.nextRefSheet}
                >
                  ›
                </button>
                <div className="expanded-sheet-indicator">
                  {expandedSheetIndex + 1} / {expandedSheet.refSheets.length}
                </div>
              </>
            )}
            <button
              className="expanded-sheet-download-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleExpandedSheetDownload();
              }}
              aria-label={t.downloadRefSheet}
            >
              <span className="expanded-sheet-download-btn__icon">⬇️</span>
              <span className="expanded-sheet-download-btn__text">{t.downloadRefSheet}</span>
            </button>
          </div>
        </div>
      )}

      {/* Lightbox - only for commissions */}
      {lightboxImage && !lightboxIsRefSheet && (
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
