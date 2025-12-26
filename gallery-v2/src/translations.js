// ============================================
// Translation Dictionary
// ============================================
export const translations = {
    en: {
        galleryTitle: "Reference Sheets & Commissions",
        selectCharacter: ["Choose a character above to view their", "reference sheets and commission gallery"],
        viewRefSheet: "View Reference Sheet",
        viewCommissions: "View Past Commissions",
        newest: "Newest",
        randomize: "Randomize",
        noCommissions: "No commissions yet for",
        noRefSheet: "No reference sheet yet",
        officialRefSheet: "Official Reference Sheet",
        clickToEnlarge: "Click to enlarge",
        downloadRefSheet: "Download Reference Sheet",
        escToClose: "ESC to close",
        arrowsToNavigate: "← → to navigate",
        commissionedFrom: "Commissioned from",
        viewOnTwitter: "View on Twitter",
        viewOnVGen: "View on VGen",
        viewOnSkeb: "View on Skeb",
        viewSource: "View Source",
        commissionTOS: "Commission ToS follow platform guidelines",
        loadingGallery: "Loading gallery...",
        unableToLoad: "Unable to load gallery",
        makeSureJSON: "Make sure",
        existsAndValid: "exists and is valid JSON.",
        previousRefSheet: "Previous reference sheet",
        nextRefSheet: "Next reference sheet",
        // Character species translations
        species: {
            "Kobold": "Kobold",
            "Cyber Princess": "Cyber Princess",
            "Gloomy Librarian": "Gloomy Librarian",
            "Happy Robo": "Happy Robo",
            "Hall Monitor": "Hall Monitor",
            "Art Cute Student": "Art Cute Student",
            "Devil Maid": "Devil Maid",
            "Pretty Derby": "Pretty Derby",
            "Mostly Video Games": "Mostly Video Games"
        },
        characterNames: {
            "UmaMusume": "UmaMusume"
        }
    },
    ja: {
        galleryTitle: "リファレンスシート＆コミッション",
        selectCharacter: ["上のキャラクターを選択して、", "リファレンスシートとコミッションギャラリーを表示します"],
        viewRefSheet: "リファレンスシートを見る",
        viewCommissions: "過去のコミッションを見る",
        newest: "最新順",
        randomize: "ランダム",
        noCommissions: "まだコミッションがありません：",
        noRefSheet: "リファレンスシートはまだありません",
        officialRefSheet: "公式リファレンスシート",
        clickToEnlarge: "クリックして拡大",
        downloadRefSheet: "リファレンスシートをダウンロード",
        escToClose: "ESCで閉じる",
        arrowsToNavigate: "← →でナビゲート",
        commissionedFrom: "コミッション元：",
        viewOnTwitter: "Twitterで見る",
        viewOnVGen: "VGenで見る",
        viewOnSkeb: "Skebで見る",
        viewSource: "ソースを見る",
        commissionTOS: "コミッション利用規約はプラットフォームのガイドラインに従います",
        loadingGallery: "ギャラリーを読み込み中...",
        unableToLoad: "ギャラリーを読み込めません",
        makeSureJSON: "確認してください：",
        existsAndValid: "が存在し、有効なJSONであること。",
        previousRefSheet: "前のリファレンスシート",
        nextRefSheet: "次のリファレンスシート",
        // Character species translations
        species: {
            "Kobold": "コボルド",
            "Cyber Princess": "サイバープリンセス",
            "Gloomy Librarian": "陰気な司書",
            "Happy Robo": "ハッピーロボ",
            "Hall Monitor": "ホールモニター",
            "Art Cute Student": "カワイイを専門とする美術学生",
            "Devil Maid": "悪魔メイド",
            "Pretty Derby": "プリティーダービー",
            "Mostly Video Games": "主にビデオゲーム"
        },
        characterNames: {
            "UmaMusume": "ウマ娘"
        }
    }
};

// Helper function to translate species
export function translateSpecies(species, lang = 'en') {
    return translations[lang]?.species?.[species] || species;
}

// Helper function to translate character names
export function translateCharacterName(name, lang = 'en') {
    return translations[lang]?.characterNames?.[name] || name;
}

// ============================================
// Platform Detection Utility
// ============================================
export function getSourcePlatform(url, lang = 'en') {
    if (!url) return null;
    const lowerUrl = url.toLowerCase();
    const t = translations[lang];

    if (lowerUrl.includes('twitter.com') || lowerUrl.includes('x.com')) {
        return { type: 'twitter', label: t.viewOnTwitter, icon: '𝕏' };
    }
    if (lowerUrl.includes('vgen.co')) {
        return { type: 'vgen', label: t.viewOnVGen, icon: 'V' };
    }
    if (lowerUrl.includes('skeb.jp')) {
        return { type: 'skeb', label: t.viewOnSkeb, icon: 'S' };
    }

    // Generic source
    return { type: 'source', label: t.viewSource, icon: '🔗' };
}

// ============================================
// Social Link Utility
// ============================================
export function getLinkInfo(type) {
    const linkTypes = {
        twitter: { label: 'Twitter', icon: '𝕏', className: 'twitter' },
        vgen: { label: 'VGen', icon: 'V', className: 'vgen' },
        vsona: { label: 'VSona', icon: 'VS', className: 'vsona' },
        carrd: { label: 'Carrd', icon: '🔗', className: 'carrd' },
        twitch: { label: 'Twitch', icon: '📺', className: 'twitch' },
        youtube: { label: 'YouTube', icon: '▶', className: 'youtube' },
        discord: { label: 'Discord', icon: '💬', className: 'discord' },
        linktree: { label: 'Linktree', icon: '🌳', className: 'linktree' },
        website: { label: 'Website', icon: '🌐', className: 'website' },
    };

    return linkTypes[type] || { label: type, icon: '🔗', className: 'generic' };
}

// ============================================
// Helper to get commissions for current selection
// ============================================
export function getCommissions(character, selectedVersion) {
    // If character has versions and a version is selected, get commissions from version
    if (character.versions && selectedVersion) {
        return selectedVersion.commissions || [];
    }
    // Fall back to character-level commissions (for characters without versions)
    return character.commissions || [];
}

// ============================================
// Helper to shuffle array (Fisher-Yates algorithm)
// ============================================
export function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

// ============================================
// Shared download utility for reference sheets
// ============================================
export async function downloadReferenceSheet(imageUrl, characterName, versionName = null, sheetIndex = 0, totalSheets = 1) {
    try {
        const response = await fetch(imageUrl);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;

        // Generate filename
        const extension = imageUrl.split('.').pop().split('?')[0] || 'png';
        const versionSlug = versionName && versionName !== 'Default'
            ? `-${versionName.toLowerCase().replace(/\s+/g, '-')}`
            : '';
        const sheetNumber = totalSheets > 1 ? `-${sheetIndex + 1}` : '';
        const filename = `${characterName.toLowerCase().replace(/\s+/g, '-')}${versionSlug}${sheetNumber}-reference-sheet.${extension}`;

        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        return { success: true, filename };
    } catch (error) {
        // Fallback: open in new tab
        window.open(imageUrl, '_blank');
        return { success: false, error };
    }
}
