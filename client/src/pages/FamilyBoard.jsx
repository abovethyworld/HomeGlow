import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { API_BASE_URL } from '../utils/apiConfig.js';
import { choreDays, dueOn } from '../utils/choreDays.js';
import { APPEARANCE_SETTING_KEY, normalizeHouseholdAppearance } from '../utils/appearance.js';
import { backgroundImageUrl } from '../utils/personalize.js';

// Family board, step 1: Today-only overview with live data, plus a read-only
// per-profile list. Tap-to-complete arrived in step 2; the 60s idle return
// arrived in step 3. Step 4: per-member backgrounds and accents. The
// overview wears the household's default background (the same appearance
// background the dashboard uses); an open profile wears that member's
// wallpaper from the Wallpaper Engine plugin's package index, with the
// wallpaper's own scheme color as the view's accent. Scene wallpapers
// stand in with their animated preview until their rebuilds land.

const boardTheme = createTheme();

const pad = (n) => String(n).padStart(2, '0');

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localDateKey(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  let hours = d.getHours();
  const minutes = pad(d.getMinutes());
  const suffix = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${suffix}`;
}

function formatLongDate() {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// Schedules left for one person today, using the same day-state logic as the
// chore widget so the overview and the profile lists can never disagree.
// 'today' means due today and not done. Carry-over schedules (until- and
// once-completed) report no due date, so they count while nothing is logged
// for them today. Known edge, fixed in step 2: a once-completed chore
// finished on an earlier day still counts until its schedule is gone.
function leftSchedulesForUser(schedules, historyRows, userId, key, pattern) {
  return (schedules || [])
    .filter((s) => Number(s.user_id) === Number(userId))
    .filter((s) => {
      const days = choreDays({ rows: historyRows, schedule: s, userId, today: key, count: 1, pattern });
      if (days[0]?.state === 'today') return true;
      if (dueOn(s, key, pattern) !== null) return false;
      const completedToday = (historyRows || []).some(
        (r) => Number(r.user_id) === Number(userId)
          && (r.chore_schedule_id === s.id || (s.chore_id != null && r.chore_id === s.chore_id))
          && r.date === key
          && (r.kind === 'completion' || r.kind == null),
      );
      return !completedToday;
    });
}

function eventIsToday(event, key) {
  if (event.all_day) {
    const start = event.start_date || localDateKey(event.start);
    const end = event.end_date || start;
    return start && end && start <= key && key <= end;
  }
  const startKey = localDateKey(event.start);
  const endKey = localDateKey(event.end) || startKey;
  return startKey && endKey && startKey <= key && key <= endKey;
}

function eventTimeLabel(event) {
  if (event.all_day) return 'All day';
  return formatTime(event.start);
}

// A Wallpaper Engine scheme color ("1 0.80784 0") as CSS, plus the text
// color that stays readable on it.
function schemeToCss(scheme) {
  if (typeof scheme !== 'string') return null;
  const parts = scheme.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [r, g, b] = parts.map((n) => Math.round(Math.min(1, Math.max(0, n)) * 255));
  return `rgb(${r}, ${g}, ${b})`;
}

function textOn(cssColor) {
  const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(cssColor || '')
    || /^#([0-9a-f]{6})$/i.exec(cssColor || '');
  if (!match) return '#fff';
  const [r, g, b] = match[0].startsWith('#')
    ? [parseInt(match[1].slice(0, 2), 16), parseInt(match[1].slice(2, 4), 16), parseInt(match[1].slice(4, 6), 16)]
    : [Number(match[1]), Number(match[2]), Number(match[3])];
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.65 ? '#1a1a1a' : '#fff';
}

function hexToRgba(hex, alpha) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// The layer form of a background: the household appearance background, or
// one member's wallpaper package (video plays; a scene stands in with its
// animated preview).
function layerFromAppearance(background) {
  if (!background) return null;
  if (background.kind === 'video') return { type: 'video', src: background.src, poster: background.poster || null, accent: null, palette: null };
  if (background.kind === 'scene') return { type: 'image', src: background.src, accent: null, palette: null };
  if (background.kind === 'image') return { type: 'image', src: backgroundImageUrl(background.file), accent: null, palette: null };
  return null;
}

function layerFromPackage(pkg) {
  if (!pkg) return null;
  const palette = pkg.palette || null;
  const accent = palette?.accent || schemeToCss(pkg.schemeColor);
  if (pkg.type === 'video' && pkg.video) return { type: 'video', src: pkg.video, poster: pkg.preview || null, accent, palette };
  if (pkg.still || pkg.preview) return { type: 'image', src: pkg.still || pkg.preview, accent, palette };
  return null;
}

// Full-screen background layer with a scrim over it, so the board's text
// and solid buttons stay readable over any wallpaper. The scrim is the
// wallpaper's own soft color in light mode and its deep color in dark.
function BoardBackground({ layer, dark }) {
  if (!layer) return null;
  const mediaStyle = {
    position: 'fixed', inset: 0, width: '100vw', height: '100%',
    objectFit: 'cover', pointerEvents: 'none',
  };
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (
    <Box aria-hidden="true" sx={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
      {layer.type === 'video' && !reduced ? (
        <video
          key={layer.src}
          src={layer.src}
          poster={layer.poster || undefined}
          autoPlay
          muted
          loop
          playsInline
          style={mediaStyle}
        />
      ) : layer.type === 'video' ? (
        layer.poster ? <img src={layer.poster} alt="" style={mediaStyle} /> : null
      ) : (
        <img src={layer.src} alt="" style={mediaStyle} />
      )}
      <Box sx={{ position: 'fixed', inset: 0, backgroundColor: (dark ? hexToRgba(layer.palette?.deep, 0.80) : hexToRgba(layer.palette?.soft, 0.66)) || (dark ? 'rgba(14, 14, 18, 0.80)' : 'rgba(250, 250, 252, 0.60)') }} />
    </Box>
  );
}

export default function FamilyBoard() {
  const [view, setView] = useState({ name: 'overview' });
  const [users, setUsers] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [historyRows, setHistoryRows] = useState([]);
  const [events, setEvents] = useState([]);
  const [weather, setWeather] = useState(null);
  const [pattern, setPattern] = useState(null);
  const [calendarError, setCalendarError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState({});
  const [actionError, setActionError] = useState(null);
  const [wallpapers, setWallpapers] = useState({ byUser: {}, defaultLayer: null });
  const [boardDark, setBoardDark] = useState(false);

  const key = useMemo(() => todayKey(), []);

  const fetchAll = useCallback(async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const [usersRes, schedulesRes, historyRes, eventsRes, weatherRes, patternRes, appearanceRes, wallpaperRes] = await Promise.allSettled([
      axios.get(`${API_BASE_URL}/api/users`),
      axios.get(`${API_BASE_URL}/api/chore-schedules`, { params: { visible: true } }),
      axios.get(`${API_BASE_URL}/api/chore-history`, { params: { date: key } }),
      axios.get(`${API_BASE_URL}/api/calendar-events`, {
        params: { start: start.toISOString(), end: end.toISOString() },
      }),
      // Household weather location; the key itself (WEATHER_API_KEY) is a
      // separate setting and still missing, so this stays hidden until then.
      axios.get(`${API_BASE_URL}/api/weather`, { params: { location: 'Savannah, GA' } }),
      // Alternating pattern for pattern-owned schedules; without it the
      // board behaves exactly as before.
      axios.get(`${API_BASE_URL}/api/household-pattern`),
      // Step 4: the household's default background, the same appearance
      // the dashboard wears.
      axios.get(`${API_BASE_URL}/api/settings`, { params: { keys: APPEARANCE_SETTING_KEY } }),
      // Step 4: per-member wallpapers, from the Wallpaper Engine plugin's
      // own storage (packages plus the profile:<userId> picks).
      axios.get(`${API_BASE_URL}/api/plugin/v1/storage/wallpaper-engine`),
    ]);
    // The bonus pseudo-user (id 0) never renders as a profile.
    if (usersRes.status === 'fulfilled' && Array.isArray(usersRes.value.data)) setUsers(usersRes.value.data.filter((u) => u.id !== 0));
    if (schedulesRes.status === 'fulfilled' && Array.isArray(schedulesRes.value.data)) setSchedules(schedulesRes.value.data);
    if (historyRes.status === 'fulfilled' && Array.isArray(historyRes.value.data)) setHistoryRows(historyRes.value.data);
    if (eventsRes.status === 'fulfilled' && Array.isArray(eventsRes.value.data)) {
      setEvents(eventsRes.value.data);
      setCalendarError(false);
    } else {
      setEvents([]);
      setCalendarError(true);
    }
    if (weatherRes.status === 'fulfilled' && weatherRes.value.data) setWeather(weatherRes.value.data);
    else setWeather(null);
    if (patternRes.status === 'fulfilled' && patternRes.value.data) setPattern(patternRes.value.data.pattern ?? null);
    else setPattern(null);
    {
      let defaultLayer = null;
      if (appearanceRes.status === 'fulfilled') {
        const appearance = normalizeHouseholdAppearance(appearanceRes.value.data?.[APPEARANCE_SETTING_KEY]);
        defaultLayer = layerFromAppearance(appearance.background);
        // The board follows the household mode. Auto resolves here by the
        // display's own scheme; the dashboard's sunrise-based auto is
        // close enough that the two rarely disagree.
        setBoardDark(appearance.mode === 'dark'
          || (appearance.mode === 'auto' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches));
      }
      const byUser = {};
      if (wallpaperRes.status === 'fulfilled' && wallpaperRes.value.data) {
        const store = wallpaperRes.value.data;
        const packages = Array.isArray(store.packages) ? store.packages : [];
        const byId = new Map(packages.map((pkg) => [String(pkg.id), pkg]));
        packages.forEach((pkg) => {
          if (pkg.ownerProfileId != null) byUser[pkg.ownerProfileId] = pkg;
        });
        Object.keys(store).forEach((storeKey) => {
          const match = /^profile:(\d+)$/.exec(storeKey);
          if (match && byId.has(String(store[storeKey]))) byUser[match[1]] = byId.get(String(store[storeKey]));
        });
        // The default background themes the overview too: when it is one
        // of the packages, borrow that package's palette.
        if (defaultLayer && !defaultLayer.palette) {
          const host = packages.find((pkg) => pkg.video === defaultLayer.src || pkg.preview === defaultLayer.src);
          if (host?.palette) defaultLayer = { ...defaultLayer, palette: host.palette };
        }
      }
      setWallpapers({ byUser, defaultLayer });
    }
    setLoading(false);
  }, [key]);

  useEffect(() => {
    fetchAll();
    const timer = setInterval(fetchAll, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [fetchAll]);

  // Step 3: 60s idle return. While a profile is open, any tap, click, or key
  // press restarts the clock; 60s without one returns to the shared overview.
  // The 5-minute data refresh is not activity and never resets the clock.
  // The dashboard's own screensaver does not run on /board (main.jsx routes
  // /board straight to this component), so this timer lives here.
  const idleTimerRef = useRef(null);
  useEffect(() => {
    if (view.name !== 'profile') return undefined;
    const arm = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => setView({ name: 'overview' }), 60 * 1000);
    };
    arm();
    window.addEventListener('pointerdown', arm);
    window.addEventListener('keydown', arm);
    return () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    };
  }, [view]);

  const todayEvents = useMemo(
    () => events.filter((e) => eventIsToday(e, key)),
    [events, key],
  );

  const leftByUser = useMemo(() => {
    const map = new Map();
    users.forEach((u) => map.set(u.id, leftSchedulesForUser(schedules, historyRows, u.id, key, pattern)));
    return map;
  }, [users, schedules, historyRows, key, pattern]);

  const totalLeft = useMemo(
    () => [...leftByUser.values()].reduce((sum, list) => sum + list.length, 0),
    [leftByUser],
  );

  const weatherText = useMemo(() => {
    if (!weather) return null;
    const temp = weather.temperature ?? weather.main?.temp;
    const condition = weather.condition ?? weather.weather?.[0]?.description ?? weather.description;
    const parts = [];
    if (temp !== undefined && temp !== null) parts.push(`${Math.round(Number(temp))}°`);
    if (condition) parts.push(String(condition));
    return parts.length > 0 ? parts.join(' · ') : null;
  }, [weather]);

  const profile = view.name === 'profile' ? users.find((u) => u.id === view.userId) : null;
  const profileLeft = profile ? leftByUser.get(profile.id) || [] : [];

  // Step 4: an open profile wears its own wallpaper and accent; the
  // overview wears the household default. A member with no wallpaper yet
  // falls back to the default rather than a blank board.
  const profileLayer = profile ? layerFromPackage(wallpapers.byUser[profile.id]) : null;
  const activeLayer = profile ? (profileLayer || wallpapers.defaultLayer) : wallpapers.defaultLayer;
  // The palette variant follows the mode: dark mode takes each
  // wallpaper's dark accent, light mode its regular one.
  const variantAccent = (layer) => (boardDark ? (layer?.palette?.dark?.accent || layer?.accent) : layer?.accent) || null;
  const profileAccent = variantAccent(profileLayer);

  // Today's completions for the open profile, for the Done section and undo.
  const doneRows = useMemo(() => {
    if (!profile) return [];
    return (historyRows || []).filter((r) => Number(r.user_id) === Number(profile.id)
      && r.date === key && (r.kind === 'completion' || r.kind == null));
  }, [historyRows, profile, key]);

  const doneTitle = (row) => {
    const s = schedules.find((x) => x.id === row.chore_schedule_id)
      || schedules.find((x) => row.chore_id != null && x.chore_id === row.chore_id);
    return s?.title || row.title || 'Chore';
  };

  // Same endpoints and body as the chore widget. A second tap while one is
  // in flight is ignored: the server would 409 and snap the row back.
  const toggleChore = useCallback(async (scheduleId, userId, toComplete) => {
    if (pending[scheduleId]) return;
    setPending((prev) => ({ ...prev, [scheduleId]: true }));
    setActionError(null);
    try {
      await axios.post(`${API_BASE_URL}/api/chores/${toComplete ? 'complete' : 'uncomplete'}`, {
        chore_schedule_id: scheduleId,
        user_id: userId,
        date: key,
      });
      await fetchAll();
    } catch (e) {
      if (e?.response?.data?.code === 'CHORE_EXPIRED') setActionError('Past due — ask a parent to handle this one.');
      else setActionError('Could not save that. Tap again.');
    } finally {
      setPending((prev) => {
        const next = { ...prev };
        delete next[scheduleId];
        return next;
      });
    }
  }, [pending, key, fetchAll]);

  return (
    <ThemeProvider theme={boardTheme}>
      <Box sx={{ minHeight: '100vh', px: 3, py: 3, boxSizing: 'border-box', position: 'relative' }}>
        <BoardBackground layer={activeLayer} dark={boardDark} />
        <Box sx={{ position: 'relative', zIndex: 1 }}>
        <Typography sx={{ fontSize: 16, letterSpacing: 3, textTransform: 'uppercase', color: 'text.secondary', mb: 1 }}>
          Eden
        </Typography>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 10 }}>
            <CircularProgress />
          </Box>
        ) : view.name === 'profile' && profile ? (
          <Box>
            <Button variant="text" onClick={() => setView({ name: 'overview' })} sx={{ fontSize: 20, mb: 2 }}>
              ← Back
            </Button>
            <Typography variant="h3" sx={{ fontWeight: 700, mb: 1, ...((boardDark ? profileLayer?.palette?.dark?.secondary : profileLayer?.palette?.deep) || profileAccent ? { color: (boardDark ? profileLayer?.palette?.dark?.secondary : profileLayer?.palette?.deep) || profileAccent } : {}) }}>
              {profile.username}
            </Typography>
            <Typography variant="h5" sx={{ mb: 3, color: 'text.secondary' }}>
              {profileLeft.length === 0 ? 'Nothing left today' : `${profileLeft.length} left today`}
            </Typography>
            {actionError ? (
              <Typography variant="h6" sx={{ mb: 2, color: 'error.main' }}>{actionError}</Typography>
            ) : null}
            {profileLeft.length === 0 ? (
              <Typography variant="h6" sx={{ color: 'text.secondary' }}>All done.</Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {profileLeft.map((s) => (
                  <Button
                    key={s.id}
                    variant="contained"
                    disabled={!!pending[s.id]}
                    onClick={() => toggleChore(s.id, profile.id, true)}
                    sx={{
                      minHeight: 88, px: 3, justifyContent: 'space-between', textAlign: 'left',
                      ...(profileAccent ? { backgroundColor: profileAccent, color: textOn(profileAccent), '&:hover': { backgroundColor: profileAccent, filter: 'brightness(1.08)' } } : {}),
                    }}
                  >
                    <Box>
                      <Typography variant="h5" component="span" sx={{ display: 'block' }}>{s.title}</Typography>
                      {s.description ? (
                        <Typography variant="body1" component="span" sx={{ display: 'block', opacity: 0.8 }}>{s.description}</Typography>
                      ) : null}
                    </Box>
                    <Typography variant="body1" component="span" sx={{ ml: 2, whiteSpace: 'nowrap', opacity: 0.8 }}>
                      {pending[s.id] ? 'Saving…' : 'Tap to complete'}
                    </Typography>
                  </Button>
                ))}
              </Box>
            )}
            {doneRows.length > 0 ? (
              <Box sx={{ mt: 4 }}>
                <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>Done today</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {doneRows.map((row) => (row.chore_schedule_id == null ? (
                    <Typography key={row.id} variant="h6" sx={{ color: 'text.secondary' }}>{doneTitle(row)}</Typography>
                  ) : (
                    <Button
                      key={row.id}
                      variant="outlined"
                      disabled={!!pending[row.chore_schedule_id]}
                      onClick={() => toggleChore(row.chore_schedule_id, profile.id, false)}
                      sx={{ minHeight: 72, px: 3, justifyContent: 'space-between', textAlign: 'left' }}
                    >
                      <Typography variant="h6" component="span" sx={{ textDecoration: 'line-through' }}>{doneTitle(row)}</Typography>
                      <Typography variant="body1" component="span" sx={{ ml: 2, whiteSpace: 'nowrap', opacity: 0.8 }}>
                        {pending[row.chore_schedule_id] ? 'Saving…' : 'Tap to undo'}
                      </Typography>
                    </Button>
                  )))}
                </Box>
              </Box>
            ) : null}
          </Box>
        ) : (
          <Box>
            <Typography variant="h3" sx={{ fontWeight: 700 }}>{formatLongDate()}</Typography>
            {weatherText ? (
              <Typography variant="h5" sx={{ mt: 1, color: 'text.secondary' }}>{weatherText}</Typography>
            ) : null}

            <Typography variant="h4" sx={{ fontWeight: 700, mt: 4, mb: 1 }}>Today</Typography>
            {calendarError ? (
              <Typography variant="h6" sx={{ color: 'text.secondary' }}>Calendar not connected yet.</Typography>
            ) : todayEvents.length === 0 ? (
              <Typography variant="h6" sx={{ color: 'text.secondary' }}>No events today.</Typography>
            ) : (
              todayEvents.map((e) => (
                <Box key={e.id || `${e.title}-${e.start}`} sx={{ display: 'flex', gap: 2, py: 1 }}>
                  <Typography variant="h6" sx={{ minWidth: 110, color: 'text.secondary' }}>
                    {eventTimeLabel(e)}
                  </Typography>
                  <Typography variant="h6">{e.title || e.summary || 'Untitled event'}</Typography>
                </Box>
              ))
            )}

            <Typography variant="h4" sx={{ fontWeight: 700, mt: 4, mb: 2 }}>
              {totalLeft === 0 ? 'No chores left' : `${totalLeft} ${totalLeft === 1 ? 'chore' : 'chores'} left`}
            </Typography>
            {users.length === 0 ? (
              <Typography variant="h6" sx={{ color: 'text.secondary' }}>
                No profiles yet. Add people in the Admin Panel.
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {users.map((u) => {
                  const left = leftByUser.get(u.id) || [];
                  const accent = (boardDark ? wallpapers.byUser[u.id]?.palette?.dark?.accent : null)
                    || wallpapers.byUser[u.id]?.palette?.accent
                    || schemeToCss(wallpapers.byUser[u.id]?.schemeColor);
                  return (
                    <Button
                      key={u.id}
                      variant="contained"
                      onClick={() => setView({ name: 'profile', userId: u.id })}
                      sx={{
                        minHeight: 88, fontSize: 24, justifyContent: 'space-between', px: 3,
                        ...(accent ? { backgroundColor: accent, color: textOn(accent), '&:hover': { backgroundColor: accent, filter: 'brightness(1.08)' } } : {}),
                      }}
                    >
                      <span>{u.username}</span>
                      <span>{left.length === 0 ? 'Done' : `${left.length} left`}</span>
                    </Button>
                  );
                })}
              </Box>
            )}
          </Box>
        )}
        </Box>
      </Box>
    </ThemeProvider>
  );
}
