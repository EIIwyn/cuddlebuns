const TIMELINE_URL = '/data/uma/timeline.json';

export async function fetchUmaTimeline(signal) {
  const response = await fetch(TIMELINE_URL, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const timeline = await response.json();
  if (timeline?.schemaVersion !== 1 || !Array.isArray(timeline.scenarios) || !Array.isArray(timeline.pvpEvents)) {
    throw new Error('Unsupported timeline data format.');
  }
  return timeline;
}
