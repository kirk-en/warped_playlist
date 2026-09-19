import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import InflatableBoard from '../../components/InflatableBoard/InflatableBoard';
import SelectionCards from '../../components/SelectionCards/SelectionCards';
import { loadSchedule, loadYearIndex, scheduleYears } from '../../data/schedule';
import './HomePage.css';

// Logos follow the naming convention assets/warped_tour_<year>_logo.<ext>. A year
// with no file yet just shows its text; drop the file in and it appears here.
const logoModules = import.meta.glob('../../assets/warped_tour_*_logo.*', {
  eager: true,
  import: 'default',
});
const logosByYear = {};
for (const [path, url] of Object.entries(logoModules)) {
  logosByYear[path.match(/warped_tour_(\d{4})_logo/)[1]] = url;
}

const years = [
  ...new Set([...Object.keys(logosByYear).map(Number), ...scheduleYears]),
].sort((a, b) => a - b);

/** "July 30, 2008" */
function dayFor(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

// The URL is the source of truth for where the user is:
//   /            landing card
//   /years       year picker
//   /2008        that year's date picker
//   /2008/<id>   the board for one date
function HomePage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { year: yearParam, id } = useParams();
  const [replaySignal, setReplaySignal] = useState(0);
  const [comingSoonYear, setComingSoonYear] = useState(null);
  // Shown under the date cards when a date has no set times yet.
  const [note, setNote] = useState(null);
  // Loaded data is stored with the key it was loaded for, so a stale result from a
  // previous URL is never shown.
  const [loadedDates, setLoadedDates] = useState(null);
  const [loadedSchedule, setLoadedSchedule] = useState(null);

  const onLanding = !yearParam && pathname === '/';
  const year = /^\d{4}$/.test(yearParam ?? '') ? Number(yearParam) : null;
  const validYear = year !== null && scheduleYears.includes(year);
  const yearDates = validYear && loadedDates?.year === year ? loadedDates.dates : [];
  const chosen =
    validYear && id && loadedSchedule?.key === `${year}/${id}` ? loadedSchedule.schedule : null;

  // An unknown year (e.g. /1999) falls back to the year picker.
  useEffect(() => {
    if (yearParam && !validYear) navigate('/years', { replace: true });
  }, [yearParam, validYear, navigate]);

  useEffect(() => {
    if (!validYear) return;
    let cancelled = false;
    loadYearIndex(year)
      .then((dates) => !cancelled && setLoadedDates({ year, dates }))
      .catch((error) => console.error('[schedule] failed to load year', year, error));
    return () => {
      cancelled = true;
    };
  }, [validYear, year]);

  useEffect(() => {
    if (!validYear || !id) return;
    let cancelled = false;
    loadSchedule(year, id)
      .then((schedule) => {
        if (cancelled) return;
        if (schedule.sets.length === 0) {
          setNote(schedule.note ?? 'Set times are not available for this date yet.');
          navigate(`/${year}`, { replace: true });
        } else {
          setNote(null);
          setLoadedSchedule({ key: `${year}/${id}`, schedule });
        }
      })
      .catch((error) => {
        console.error('[schedule] failed to load', id, error);
        if (!cancelled) navigate(`/${year}`, { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [validYear, year, id, navigate]);

  const chooseYear = (y) => {
    if (!scheduleYears.includes(y)) {
      setComingSoonYear(y);
      return;
    }
    setNote(null);
    navigate(`/${y}`);
  };

  const goTo = (path) => () => {
    setComingSoonYear(null);
    setNote(null);
    navigate(path);
  };

  const crumbs = [];
  if (!onLanding) {
    crumbs.push({ label: 'Home', onClick: goTo('/') });
    if (validYear) {
      crumbs.push({ label: 'Years', onClick: goTo('/years') });
      crumbs.push({ label: String(year), onClick: goTo(`/${year}`) });
      const entry = yearDates.find((d) => d.id === id);
      if (chosen && entry) crumbs.push({ label: `${entry.city}, ${entry.state}` });
    }
  }
  // The last crumb is where the user is now, so it is not a link.
  if (crumbs.length) delete crumbs[crumbs.length - 1].onClick;

  return (
    <div className="home-page">
      {crumbs.length > 1 && (
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <ol>
            {crumbs.map((crumb) => (
              <li key={crumb.label}>
                {crumb.onClick ? (
                  <button type="button" onClick={crumb.onClick}>
                    {crumb.label}
                  </button>
                ) : (
                  <span aria-current="page">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}
      {chosen ? (
        <>
          <InflatableBoard
            stages={chosen.stages}
            sets={chosen.sets}
            replaySignal={replaySignal}
          />
          <button
            type="button"
            className="replay-button"
            onClick={() => setReplaySignal((n) => n + 1)}
          >
            Replay
          </button>
        </>
      ) : validYear ? (
        !id && (
          <SelectionCards
            prompt="Pick your date"
            layout="wide"
            message={note ?? undefined}
            cards={yearDates.map((entry) => ({
              id: entry.id,
              title: dayFor(entry.date),
              caption: `${entry.city}, ${entry.state} · ${entry.venue}`,
              unavailableNote: entry.note,
              onSelect: () => navigate(`/${year}/${entry.id}`),
            }))}
          />
        )
      ) : !onLanding ? (
        <SelectionCards
          prompt="Pick your year"
          message={comingSoonYear ? `Warped Tour ${comingSoonYear} is coming soon.` : undefined}
          cards={years.map((y) => ({
            id: String(y),
            title: `Warped Tour ${y}`,
            image: logosByYear[y],
            onSelect: () => chooseYear(y),
          }))}
        />
      ) : (
        <SelectionCards
          prompt="Warped playlist"
          cards={[
            {
              id: 'start',
              title: 'Get started',
              onSelect: () => navigate('/years'),
            },
          ]}
        />
      )}
    </div>
  );
}

export default HomePage;
