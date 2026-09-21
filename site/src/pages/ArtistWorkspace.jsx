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

function imageUrl(collection, record, filename, token) {
  if (!filename) return '';
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return apiUrl(`/api/files/${encodeURIComponent(collection)}/${encodeURIComponent(record.id)}/${encodeURIComponent(filename)}${query}`);
}

function priceLabel(record) {
  const directAmount = Number(record.price_amount);
  if (Number.isFinite(directAmount) && directAmount > 0) {
    return `${record.price_currency || 'Price'} ${record.price_amount}`;
  }
  const prices = [
    { currency: 'JPY', amount: Number(record.price_jpy) },
    { currency: 'USD', amount: Number(record.price_usd) },
  ].filter(({ amount }) => Number.isFinite(amount) && amount > 0);
  if (!prices.length) return 'Price not listed';
  const selected = prices.reduce((highest, current) => current.amount > highest.amount ? current : highest);
  return `${selected.currency} ${selected.amount}`;
}

function relationIds(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((item) => typeof item === 'object' ? item?.id : item).filter(Boolean).map(String);
}

function CardImage({ record, token, onUpload, onOpenImage, uploading }) {
  const exampleFiles = Array.isArray(record.example) ? record.example : record.example ? [record.example] : [];
  const commissionFiles = record.status === 'Worked' && record.latestCommission
    ? (Array.isArray(record.latestCommission.image) ? record.latestCommission.image : record.latestCommission.image ? [record.latestCommission.image] : [])
    : [];
  const files = commissionFiles.length ? commissionFiles : exampleFiles;
  const collection = commissionFiles.length ? 'commissions' : 'artists';
  const imageRecord = commissionFiles.length ? record.latestCommission : record;
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
      <button type="button" className="artist-workspace-card__image-button" onClick={() => onOpenImage({ record: imageRecord, collection, files }, 0)}>
        <img
          src={imageUrl(collection, imageRecord, files[0], token)}
          alt={`${record.artist_name || 'Artist'} example artwork — expand image`}
          className="artist-workspace-card__image"
        />
      </button>
      {files.length > 1 && <span className="artist-workspace-card__image-count">＋{files.length - 1}</span>}
    </div>
  );
}

function ArtistCard({ record, token, onUpload, onOpenImage, onOpenDetails, uploading }) {
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
          <button type="button" onClick={() => onOpenDetails(record)}>Edit</button>
        </div>
      </div>
    </article>
  );
}

function ArtistDetailDrawer({ record, onClose, onSave, saving, saveError }) {
  const [form, setForm] = useState(() => ({
    artist_name: record.artist_name || '',
    url: record.url || '',
    status: record.status || 'Candidate',
    price_bracket: record.price_bracket || '',
    price_jpy: record.price_jpy ?? '',
    price_usd: record.price_usd ?? '',
    commission_subject: Array.isArray(record.commission_subject) ? record.commission_subject.join(', ') : '',
    notes: record.notes || '',
  }));

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submit(event) {
    event.preventDefault();
    onSave(record.id, {
      artist_name: form.artist_name.trim(),
      url: form.url.trim(),
      status: form.status,
      price_bracket: form.price_bracket,
      price_jpy: form.price_jpy === '' ? null : Number(form.price_jpy),
      price_usd: form.price_usd === '' ? null : Number(form.price_usd),
      commission_subject: form.commission_subject.split(',').map((subject) => subject.trim()).filter(Boolean),
      notes: form.notes,
    });
  }

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape' && !saving) onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  return (
    <div className="artist-detail-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
      <aside className="artist-detail-drawer" role="dialog" aria-modal="true" aria-labelledby="artist-detail-title">
        <header className="artist-detail-drawer__header">
          <div><p className="eyebrow">Artist record</p><h2 id="artist-detail-title">{record.artist_name || 'Unnamed artist'}</h2></div>
          <button type="button" className="artist-detail-drawer__close" onClick={onClose} disabled={saving} aria-label="Close artist details">×</button>
        </header>
        <form className="artist-detail-drawer__form" onSubmit={submit}>
          <label>Artist name<input value={form.artist_name} onChange={(event) => update('artist_name', event.target.value)} required /></label>
          <label>Profile URL<input type="url" value={form.url} onChange={(event) => update('url', event.target.value)} /></label>
          <div className="artist-detail-drawer__row">
            <label>Status<select value={form.status} onChange={(event) => update('status', event.target.value)}>{STATUS_OPTIONS.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Price bracket<select value={form.price_bracket} onChange={(event) => update('price_bracket', event.target.value)}><option value="">Not set</option>{PRICE_OPTIONS.filter((item) => item !== '(Empty)').map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          </div>
          <div className="artist-detail-drawer__row">
            <label>Price (JPY)<input type="number" min="0" step="any" value={form.price_jpy} onChange={(event) => update('price_jpy', event.target.value)} /></label>
            <label>Price (USD)<input type="number" min="0" step="any" value={form.price_usd} onChange={(event) => update('price_usd', event.target.value)} /></label>
          </div>
          <label>Commission subjects<input value={form.commission_subject} onChange={(event) => update('commission_subject', event.target.value)} placeholder="Portrait, reference sheet" /></label>
          <label>Notes<textarea value={form.notes} onChange={(event) => update('notes', event.target.value)} rows="7" placeholder="Style notes, commission ideas, or descriptors" /></label>
          {saveError && <p className="artist-workspace__error" role="alert">{saveError}</p>}
          <footer className="artist-detail-drawer__footer">
            <button type="button" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="is-primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          </footer>
        </form>
      </aside>
    </div>
  );
}

function ImageLightbox({ record, collection, files, token, startIndex, onClose }) {
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
        <img src={imageUrl(collection, record, filename, token)} alt={`${record.artist_name || 'Artist'} example artwork ${index + 1}`} />
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
  const [detailRecord, setDetailRecord] = useState(null);
  const [savingId, setSavingId] = useState('');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (!token) return undefined;
    const controller = new AbortController();
    async function loadCollection(collection) {
      const recordsForCollection = [];
      let page = 1;
      let totalPages = 1;
      do {
        const sort = collection === 'artists' ? 'artist_name' : '-date,date';
        const result = await request(`/api/collections/${collection}/records?page=${page}&perPage=200&sort=${encodeURIComponent(sort)}`, { signal: controller.signal }, token);
        recordsForCollection.push(...(result.items || []));
        totalPages = result.totalPages || 1;
        page += 1;
      } while (page <= totalPages);
      return recordsForCollection;
    }

    Promise.all([loadCollection('artists'), loadCollection('commissions')])
      .then(async ([artists, commissions]) => {
        const latestByArtist = new Map();
        for (const commission of commissions) {
          for (const artistId of relationIds(commission.artists)) {
            const current = latestByArtist.get(artistId);
            const currentTime = current?.date ? Date.parse(current.date) : -Infinity;
            const commissionTime = commission.date ? Date.parse(commission.date) : -Infinity;
            if (!current || commissionTime >= currentTime) latestByArtist.set(artistId, commission);
          }
        }
        setRecords(artists.map((artist) => ({
          ...artist,
          latestCommission: latestByArtist.get(artist.id),
        })));
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

  async function saveArtist(recordId, updates) {
    setSavingId(recordId);
    setSaveError('');
    try {
      const updated = await request(`/api/collections/artists/records/${encodeURIComponent(recordId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      }, token);
      setRecords((current) => current.map((item) => item.id === recordId
        ? { ...updated, latestCommission: item.latestCommission }
        : item));
      setDetailRecord((current) => current?.id === recordId
        ? { ...updated, latestCommission: current.latestCommission }
        : current);
    } catch (saveRequestError) {
      setSaveError(saveRequestError.message);
    } finally {
      setSavingId('');
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
        {loading ? <p className="artist-workspace__state">Loading artists…</p> : visibleRecords.length > 0 ? <section className="artist-workspace__grid" aria-label="Artists">{visibleRecords.map((record) => <ArtistCard key={record.id} record={record} token={fileToken} onUpload={uploadExample} onOpenImage={(imageSource, index) => setLightbox({ ...imageSource, index })} onOpenDetails={setDetailRecord} uploading={uploadingId === record.id} />)}</section> : <p className="artist-workspace__state">No artists match these filters.</p>}
      </main>
      {lightbox && <ImageLightbox record={lightbox.record} collection={lightbox.collection} files={lightbox.files} token={fileToken} startIndex={lightbox.index} onClose={() => setLightbox(null)} />}
      {detailRecord && <ArtistDetailDrawer key={detailRecord.id} record={detailRecord} onClose={() => { setDetailRecord(null); setSaveError(''); }} onSave={saveArtist} saving={savingId === detailRecord.id} saveError={saveError} />}
    </div>
  );
}
