import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Routes, Route, useSearchParams } from 'react-router-dom';
import { Hub } from './pages/Hub';
import { Gallery } from './pages/Gallery';
import { Home } from './pages/Home';
import { ArtistWorkspace } from './pages/ArtistWorkspace';

const UmaTimeline = lazy(() => import('./pages/UmaTimeline'));

function GalleryRoute() {
  const [searchParams] = useSearchParams();
  const isCmsHost = typeof window !== 'undefined' && window.location.hostname === 'cms.cuddlebuns.moe';

  if (isCmsHost) return <Navigate to="/editor" replace />;
  if (searchParams.get('workspace') === '1') return <ArtistWorkspace />;
  return searchParams.has('character') ? <Gallery /> : <Hub />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/characters" element={<Navigate to="/gallery" replace />} />
        <Route path="/gallery" element={<GalleryRoute />} />
        <Route path="/editor" element={<ArtistWorkspace />} />
        <Route path="/gallery-noco" element={<Navigate to="/gallery" replace />} />
        <Route
          path="/uma/timeline"
          element={(
            <Suspense fallback={<div className="site-shell"><div className="loading-container">Loading timeline…</div></div>}>
              <UmaTimeline />
            </Suspense>
          )}
        />
        <Route path="/uma" element={<Navigate to="/uma/timeline" replace />} />

        {/* Old bare /gallery WIP, retained for future implementation. */}
        <Route path="/gallery-lab" element={<Gallery />} />

        {/* Future routes */}
        {/* <Route path="/movies" element={<Movies />} /> */}
        {/* <Route path="/series" element={<Series />} /> */}
      </Routes>
    </BrowserRouter>
  );
}

export default App;
