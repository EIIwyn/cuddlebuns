import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import { Hub } from './pages/Hub';
import { Gallery } from './pages/Gallery';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/gallery" element={<Hub />} />
        <Route path="/characters" element={<Navigate to="/" replace />} />
        <Route path="/gallery-noco" element={<Navigate to="/gallery" replace />} />

        {/* Old /gallery WIP, retained for later repurposing */}
        <Route path="/gallery-lab" element={<Gallery />} />

      </Routes>
    </BrowserRouter>
  );
}

export default App;
