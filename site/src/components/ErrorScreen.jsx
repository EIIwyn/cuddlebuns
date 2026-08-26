import { translations } from '../translations';

export function ErrorScreen({ message, lang = 'en', artifact = null }) {
    const t = translations[lang];
    return (
        <div className="error-container">
            <div className="error-icon">😕</div>
            <h2>{t.unableToLoad}</h2>
            <p className="error-message">{message}</p>
            {artifact && (
                <p className="error-message" style={{ marginTop: '20px' }}>
                    {t.makeSureJSON} <code>{artifact}</code> {t.existsAndValid}
                </p>
            )}
        </div>
    );
}
