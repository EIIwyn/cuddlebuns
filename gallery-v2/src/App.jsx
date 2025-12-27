import { useState, useEffect } from 'react';
import { translations, getCommissions, shuffleArray } from './translations';
import { LoadingScreen } from './components/LoadingScreen';
import { ErrorScreen } from './components/ErrorScreen';
import { CharacterButton } from './components/CharacterButton';
import { VersionSelector } from './components/VersionSelector';
import { SocialLinks } from './components/SocialLinks';
import { ReferenceSheet } from './components/ReferenceSheet';
import { CommissionsGrid } from './components/CommissionsGrid';
import { Lightbox } from './components/Lightbox';

function App() {
  const [characters, setCharacters] = useState([]);
  const [selectedChar, setSelectedChar] = useState(null);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [showCommissions, setShowCommissions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [language, setLanguage] = useState('en');
  const [sortOrder, setSortOrder] = useState('random');
  const [refSheetIndex, setRefSheetIndex] = useState(0);

  // Lightbox state
  const [lightboxImage, setLightboxImage] = useState(null);
  const [lightboxInfo, setLightboxInfo] = useState(null);
  const [lightboxIsRefSheet, setLightboxIsRefSheet] = useState(false);
  const [lightboxVersionName, setLightboxVersionName] = useState(null);
  const [lightboxRefSheetIndex, setLightboxRefSheetIndex] = useState(0);

  const t = translations[language];

  // Load characters data
  useEffect(() => {
    fetch('./characters.json')
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

  // Handle character selection
  const handleCharacterSelect = (character) => {
    setSelectedChar(character);
    setShowCommissions(false);
    setRefSheetIndex(0);
    if (character.versions && character.versions.length > 0) {
      setSelectedVersion(character.versions[0]);
    } else {
      setSelectedVersion(null);
    }
  };

  // Handle version selection
  const handleVersionSelect = (version) => {
    setSelectedVersion(version);
    setRefSheetIndex(0);
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

  // Get commissions for selected character/version
  const commissions = selectedChar && selectedVersion
    ? getCommissions(selectedChar, selectedVersion)
    : [];

  // Sort commissions
  const sortedCommissions = sortOrder === 'random'
    ? shuffleArray(commissions)
    : [...commissions].reverse();

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
        <nav className="character-nav">
          {characters.map(character => (
            <CharacterButton
              key={character.id}
              character={character}
              isSelected={selectedChar?.id === character.id}
              onClick={() => handleCharacterSelect(character)}
              lang={language}
            />
          ))}
        </nav>

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

export default App;
