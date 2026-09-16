import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

const AUTH_COLLECTION = import.meta.env.VITE_POCKETBASE_AUTH_COLLECTION || 'users';
const TOKEN_KEY = 'cuddlebuns.cms.token';
const STATUS_OPTIONS = ['Candidate', 'Reserve', 'Worked', 'Assigned'];
const PRICE_OPTIONS = ['Affordable', 'Balanced', 'Premium', 'Upscale', '(Empty)'];

function apiUrl(path) {
  const base = import.meta.env.VITE_POCKETBASE_URL || '';
  return `${base}${path}`;
}

async function request(path, options = {}, token = '') {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (token) headers.set('Authorization', token);
  const response = await fetch(apiUrl(path), { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || `PocketBase returned HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function imageUrl(record, filename, token) {
  if (!filename) return '';
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return apiUrl(`/api/files/artists/${encodeURIComponent(record.id)}/${encodeURIComponent(filename)}${query}`);
}

function priceLabel(record) {
  const amount = record.price_amount ?? record.price_jpy ?? record.price_usd;
  if (amount == null || amount === '') return 'Price not listed';
  const currency = record.price_currency || (record.price_jpy != null ? 'JPY' : 'USD');
  return `${currency} ${amount}`;
}

function CardImage({ record, token, onUpload, onOpenImage, uploading }) {
  const files = Array.isArray(record.example) ? record.example : record.example ? [record.example] : [];
  if (!files.length) return (
    <div className="artist-workspace-card__empty-image">
      <span>Needs example</span>
      <label className="artist-workspace-card__upload">
        {uploading ? 'Uploading…' : 'Upload example'}
        <input type="file" accept="image/avif,image/gif,image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => onUpload(event.target.files?.[0])} />
      </label>
    </div>
  );
  return (
    <div className="artist-workspace-card__image-wrap">
      <button type="button" className="artist-workspace-card__image-button" onClick={() => onOpenImage(record, 0)}>
        <img
          src={imageUrl(record, files[0], token)}
          alt={`${record.artist_name || 'Artist'} example artwork — expand image`}
          className="artist-workspace-card__image"
        />
      </button>
      {files.length > 1 && <span className="artist-workspace-card__image-count">＋{files.length - 1}</span>}
    </div>
  );
}

function ArtistCard({ record, token, onUpload, onOpenImage, uploading }) {
  const subjects = Array.isArray(record.commission_subject) ? record.commission_subject : [];
  const notes = String(record.notes || '').trim();
  return (
    <article className="artist-workspace-card">
      <CardImage record={record} token={token} onUpload={(file) => onUpload(record, file)} onOpenImage={onOpenImage} uploading={uploading} />
      <div className="artist-workspace-card__body">
        <div className="artist-workspace-card__heading">
          <h3>{record.artist_name || 'Unnamed artist'}</h3>
          <span className="artist-workspace-card__status">{record.status || 'Needs review'}</span>
        </div>
        <div className="artist-workspace-card__meta">
          <span>{record.price_bracket || 'Price bracket unset'}</span>
          <strong>{priceLabel(record)}</strong>
        </div>
        {subjects.length > 0 && (
          <div className="artist-workspace-card__tags" aria-label="Commission subjects">
            {subjects.map((subject) => <span key={subject}>{subject}</span>)}
          </div>
        )}
        <p className={`artist-workspace-card__notes${notes ? '' : ' is-empty'}`}>
          {notes || 'No notes yet.'}
        </p>
        <div className="artist-workspace-card__actions">
          <a href={record.url} target="_blank" rel="noreferrer">Open profile ↗</a>
          <button type="button" disabled title="Editing is coming in the next workspace slice">Edit</button>
        </div>
      </div>
    </article>
  );
}

function ImageLightbox({ record, token, startIndex, onClose }) {
  const files = Array.isArray(record.example) ? record.example : [record.example];
  const [index, setIndex] = useState(startIndex);
  const filename = files[index];

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') setIndex((current) => (current - 1 + files.length) % files.length);
      if (event.key === 'ArrowRight') setIndex((current) => (current + 1) % files.length);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [files.length, onClose]);

  return (
    <div className="artist-workspace-lightbox" role="dialog" aria-modal="true" aria-label={`${record.artist_name || 'Artist'} example artwork`} onClick={onClose}>
      <button type="button" className="artist-workspace-lightbox__close" onClick={onClose} aria-label="Close image">×</button>
      <div className="artist-workspace-lightbox__content" onClick={(event) => event.stopPropagation()}>
        <img src={imageUrl(record, filename, token)} alt={`${record.artist_name || 'Artist'} example artwork ${index + 1}`} />
        {files.length > 1 && (
          <div className="artist-workspace-lightbox__controls">
            <button type="button" onClick={() => setIndex((current) => (current - 1 + files.length) % files.length)} aria-label="Previous example">←</button>
            <span>{index + 1} / {files.length}</span>
            <button type="button" onClick={() => setIndex((current) => (current + 1) % files.length)} aria-label="Next example">→</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Login({ onLogin, error }) {
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await request(`/api/collections/${encodeURIComponent(AUTH_COLLECTION)}/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity, password }),
      });
      localStorage.setItem(TOKEN_KEY, result.token);
      onLogin(result.token);
    } catch (requestError) {
      onLogin('', requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="artist-workspace-login page-width">
      <p className="eyebrow">Private workspace</p>
      <h1>Artist gallery</h1>
      <p>Sign in to review artists, notes, pricing, and example artwork.</p>
      <form onSubmit={submit} className="artist-workspace-login__form">
        <label>Email or username<input value={identity} onChange={(event) => setIdentity(event.target.value)} autoComplete="username" required /></label>
        <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
        {error && <p className="artist-workspace__error" role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}

export function ArtistWorkspace() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [fileToken, setFileToken] = useState('');
  const [loginError, setLoginError] = useState('');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState('');
  const [status, setStatus] = useState('Candidate');
  const [price, setPrice] = useState('All prices');
  const [query, setQuery] = useState('');
  const [showNeedsExample, setShowNeedsExample] = useState(false);
  const [uploadingId, setUploadingId] = useState('');
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    if (!token) return undefined;
    const controller = new AbortController();
    async function loadArtists() {
      const artists = [];
      let page = 1;
      let totalPages = 1;
      do {
        const result = await request(`/api/collections/artists/records?page=${page}&perPage=200&sort=artist_name`, { signal: controller.signal }, token);
        artists.push(...(result.items || []));
        totalPages = result.totalPages || 1;
        page += 1;
      } while (page <= totalPages);
      return artists;
    }

    loadArtists()
      .then(async (artists) => {
        setRecords(artists);
        const fileAccess = await request('/api/files/token', { method: 'POST', signal: controller.signal }, token);
        setFileToken(fileAccess.token || '');
      })
      .catch((requestError) => {
        if (requestError.name === 'AbortError') return;
        setError(requestError.message);
        if ([401, 403].includes(requestError.status) || /401|403|unauthorized/i.test(requestError.message)) {
          localStorage.removeItem(TOKEN_KEY);
          setToken('');
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [token]);

  const counts = useMemo(() => Object.fromEntries(STATUS_OPTIONS.map((item) => [
    item, records.filter((record) => record.status === item).length,
  ])), [records]);

  const visibleRecords = useMemo(() => records.filter((record) => {
    const matchesStatus = status === 'All artists' || record.status === status;
    const bracket = record.price_bracket || '(Empty)';
    const matchesPrice = price === 'All prices' || bracket === price;
    const matchesExample = !showNeedsExample || !record.example || (Array.isArray(record.example) && record.example.length === 0);
    const needle = query.trim().toLowerCase();
    const matchesQuery = !needle || [record.artist_name, record.notes, record.url]
      .some((value) => String(value || '').toLowerCase().includes(needle));
    return matchesStatus && matchesPrice && matchesExample && matchesQuery;
  }), [price, query, records, showNeedsExample, status]);

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    setToken('');
    setFileToken('');
    setRecords([]);
    setLoading(false);
  }

  async function uploadExample(record, file) {
    if (!file) return;
    setUploadingId(record.id);
    setError('');
    const body = new FormData();
    body.append('example', file);
    try {
      const updated = await request(`/api/collections/artists/records/${encodeURIComponent(record.id)}`, {
        method: 'PATCH',
        body,
      }, token);
      setRecords((current) => current.map((item) => item.id === record.id ? updated : item));
    } catch (uploadError) {
      setError(uploadError.message);
    } finally {
      setUploadingId('');
    }
  }

  if (!token) return <Login error={loginError} onLogin={(nextToken, nextError = '') => { setToken(nextToken); setLoginError(nextError); setLoading(Boolean(nextToken)); }} />;

  return (
    <div className="site-shell artist-workspace-shell">
      <header className="artist-workspace-header">
        <div className="page-width artist-workspace-header__inner">
          <a href="https://cuddlebuns.moe/gallery" className="artist-workspace-header__brand">Cuddlebuns <span>/ Artist gallery</span></a>
          <button type="button" onClick={logout} className="artist-workspace-header__logout">Sign out</button>
        </div>
      </header>
      <main className="artist-workspace page-width">
        <div className="artist-workspace__intro">
          <div><p className="eyebrow">Editorial workspace</p><h1>Artist gallery</h1><p>Review candidates quickly, then open the profile when you’re ready to commission.</p></div>
          <div className="artist-workspace__total"><strong>{visibleRecords.length}</strong><span>showing</span></div>
        </div>
        <div className="artist-workspace__toolbar">
          <div className="artist-workspace__statuses" role="tablist" aria-label="Artist status">
            <button type="button" className={status === 'All artists' ? 'is-active' : ''} onClick={() => setStatus('All artists')}>All <span>{records.length}</span></button>
            {STATUS_OPTIONS.map((item) => <button type="button" key={item} className={status === item ? 'is-active' : ''} onClick={() => setStatus(item)}>{item} <span>{counts[item]}</span></button>)}
          </div>
          <div className="artist-workspace__filters">
            <label className="artist-workspace__search"><span className="visually-hidden">Search artists</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search artists or notes" /></label>
            <select value={price} onChange={(event) => setPrice(event.target.value)} aria-label="Filter by price bracket"><option>All prices</option>{PRICE_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select>
            <button type="button" className={showNeedsExample ? 'is-active' : ''} onClick={() => setShowNeedsExample((value) => !value)}>Needs example</button>
          </div>
        </div>
        {error && <p className="artist-workspace__error" role="alert">{error}</p>}
        {loading ? <p className="artist-workspace__state">Loading artists…</p> : visibleRecords.length > 0 ? <section className="artist-workspace__grid" aria-label="Artists">{visibleRecords.map((record) => <ArtistCard key={record.id} record={record} token={fileToken} onUpload={uploadExample} onOpenImage={(imageRecord, index) => setLightbox({ record: imageRecord, index })} uploading={uploadingId === record.id} />)}</section> : <p className="artist-workspace__state">No artists match these filters.</p>}
      </main>
      {lightbox && <ImageLightbox record={lightbox.record} token={fileToken} startIndex={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  );
}
