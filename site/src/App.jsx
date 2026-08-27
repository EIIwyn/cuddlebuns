import { BrowserRouter, Navigate, Routes, Route, useSearchParams } from 'react-router-dom';
import { Hub } from './pages/Hub';
import { Gallery } from './pages/Gallery';

function GalleryRoute() {
  const [searchParams] = useSearchParams();

  return searchParams.has('character') ? <Gallery /> : <Hub />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Hub />} />
        <Route path="/characters" element={<Navigate to="/" replace />} />
        <Route path="/gallery" element={<GalleryRoute />} />
        <Route path="/gallery-noco" element={<Navigate to="/gallery" replace />} />

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
