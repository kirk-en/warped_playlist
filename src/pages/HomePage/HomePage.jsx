import { useState } from 'react';
import InflatableBoard from '../../components/InflatableBoard/InflatableBoard';
import { sets, stages } from '../../data/mockSchedule2008';
import './HomePage.css';

function HomePage() {
  const [replaySignal, setReplaySignal] = useState(0);

  return (
    <div className="home-page">
      <InflatableBoard stages={stages} sets={sets} replaySignal={replaySignal} />
      <button
        type="button"
        className="replay-button"
        onClick={() => setReplaySignal((n) => n + 1)}
      >
        Replay
      </button>
    </div>
  );
}

export default HomePage;
