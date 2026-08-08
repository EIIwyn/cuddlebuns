import { useState } from 'react';
import { translateCharacterName, translateCharacterSubtitle, translateSpecies } from '../translations';

export function CharacterButton({ character, isSelected, onClick, lang = 'en' }) {
    const [isHovered, setIsHovered] = useState(false);

    const buttonStyle = {
        background: isSelected
            ? `linear-gradient(135deg, ${character.color}40, ${character.color}20)`
            : 'rgba(255,255,255,0.03)',
        borderColor: isSelected ? character.color : (isHovered ? `${character.color}80` : 'rgba(255,255,255,0.1)'),
        transform: isSelected ? 'scale(1.05)' : (isHovered ? 'scale(1.02)' : 'scale(1)'),
        boxShadow: isSelected
            ? `0 8px 32px ${character.color}30, inset 0 1px 0 rgba(255,255,255,0.1)`
            : '0 4px 16px rgba(0,0,0,0.2)',
    };

    const subtitleOverride = translateCharacterSubtitle(character.name, lang);
    const subtitle = character.name === 'Touhou'
        ? (lang === 'ja' ? 'プロジェクト' : 'Project')
        : character.name === 'OC'
            ? ''
            : subtitleOverride || translateSpecies(character.species, lang);

    return (
        <button
            className="character-btn"
            style={buttonStyle}
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <div
                className="character-btn__indicator"
                style={{
                    background: character.color,
                    boxShadow: `0 0 12px ${character.color}80`
                }}
            />
            <div className="character-btn__name">{translateCharacterName(character.name, lang)}</div>
            {subtitle && (
                <div className="character-btn__species">{subtitle}</div>
            )}
        </button>
    );
}
