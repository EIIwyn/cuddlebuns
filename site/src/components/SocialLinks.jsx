import { getLinkInfo } from '../translations';

export function SocialLinks({ character }) {
    if (!character.links || character.links.length === 0) return null;

    return (
        <div className="social-links-container">
            <div className="social-links">
                {character.links.map((link, index) => {
                    const linkInfo = getLinkInfo(link.type);
                    return (
                        <a
                            key={index}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`social-link-btn social-link-btn--${linkInfo.className}`}
                            title={linkInfo.label}
                        >
                            <span className="social-link-icon">{linkInfo.icon}</span>
                            <span className="social-link-label">{linkInfo.label}</span>
                        </a>
                    );
                })}
            </div>
        </div>
    );
}
