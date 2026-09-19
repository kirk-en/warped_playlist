import { useState } from 'react';
import InflatableBoard from '../../components/InflatableBoard/InflatableBoard';
import SelectionCards from '../../components/SelectionCards/SelectionCards';
import { loadSchedule, scheduleIndex } from '../../data/schedule';
import './HomePage.css';

const TEST_SCHEDULE_ID = '2008-07-30-cincinnati';

/** "July 30, 2008 · Cincinnati, OH · Riverbend Music Center" */
function captionFor({ date, city, state, venue }) {
  const day = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  return `${day} · ${city}, ${state} · ${venue}`;
}

function HomePage() {
  const [replaySignal, setReplaySignal] = useState(0);
  // The loaded schedule; null while the user is still choosing. Only the test
  // date exists for now, so a single card loads it.
  const [chosen, setChosen] = useState(null);
  const [loading, setLoading] = useState(false);

  const testSummary = scheduleIndex.find((entry) => entry.id === TEST_SCHEDULE_ID);

  const choose = async (id) => {
    if (loading) return;
    setLoading(true);
    try {
      setChosen(await loadSchedule(id));
    } catch (error) {
      console.error('[schedule] failed to load', id, error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="home-page">
      {chosen ? (
        <>
          <InflatableBoard stages={chosen.stages} sets={chosen.sets} replaySignal={replaySignal} />
          <button
            type="button"
            className="replay-button"
            onClick={() => setReplaySignal((n) => n + 1)}
          >
            Replay
          </button>
        </>
      ) : (
        <SelectionCards
          prompt="Pick your tour"
          cards={[
            {
              id: TEST_SCHEDULE_ID,
              title: 'Get started',
              caption: captionFor(testSummary),
              onSelect: () => choose(TEST_SCHEDULE_ID),
            },
          ]}
        />
      )}
    </div>
  );
}

export default HomePage;
