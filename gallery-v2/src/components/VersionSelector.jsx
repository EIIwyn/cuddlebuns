export function VersionSelector({ versions, selectedVersion, onSelectVersion, accentColor }) {
    if (!versions || versions.length <= 1) return null;

    return (
        <div className="version-selector">
            {versions.map((version) => {
                const commissionCount = version.commissions?.length || 0;
                return (
                    <button
                        key={version.id}
                        className={`version-btn ${selectedVersion.id === version.id ? 'version-btn--active' : ''}`}
                        style={{
                            borderColor: selectedVersion.id === version.id ? accentColor : undefined,
                            background: selectedVersion.id === version.id ? `${accentColor}20` : undefined,
                            color: selectedVersion.id === version.id ? accentColor : undefined,
                        }}
                        onClick={() => onSelectVersion(version)}
                    >
                        {version.name}
                        {commissionCount > 0 && (
                            <span style={{
                                marginLeft: '6px',
                                opacity: 0.6,
                                fontSize: '0.75rem'
                            }}>
                                ({commissionCount})
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
