export function VersionSelector({ versions, selectedVersion, onSelectVersion }) {
  if (!versions || versions.length <= 1) return null;

  return (
    <nav className="version-tabs" aria-label="Character versions">
      {versions.map((version) => (
        <button
          key={version.id}
          className={selectedVersion.id === version.id ? 'version-tab version-tab--active' : 'version-tab'}
          onClick={() => onSelectVersion(version)}
          aria-current={selectedVersion.id === version.id ? 'page' : undefined}
        >
          <span>{version.name}</span>
        </button>
      ))}
    </nav>
  );
}
