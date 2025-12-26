import { translations } from '../translations';

export function LoadingScreen({ lang = 'en' }) {
    const t = translations[lang];
    return (
        <div className="loading-container">
            <div className="loading-spinner"></div>
            <p className="loading-text">{t.loadingGallery}</p>
        </div>
    );
}
