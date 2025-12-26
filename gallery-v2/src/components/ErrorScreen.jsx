import { translations } from '../translations';

export function ErrorScreen({ message, lang = 'en' }) {
    const t = translations[lang];
    return (
        <div className="error-container">
            <div className="error-icon">😕</div>
            <h2>{t.unableToLoad}</h2>
            <p className="error-message">{message}</p>
            <p className="error-message" style={{ marginTop: '20px' }}>
                {t.makeSureJSON} <code>characters.json</code> {t.existsAndValid}
            </p>
        </div>
    );
}
