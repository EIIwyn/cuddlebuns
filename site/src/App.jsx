import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import { Hub } from './pages/Hub';
import { Gallery } from './pages/Gallery';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Hub />} />
        <Route path="/gallery" element={<Gallery />} />
        <Route path="/gallery-noco" element={<Navigate to="/gallery" replace />} />
        {/* Future routes */}
        {/* <Route path="/movies" element={<Movies />} /> */}
        {/* <Route path="/series" element={<Series />} /> */}
      </Routes>
    </BrowserRouter>
  );
}

export default App;
