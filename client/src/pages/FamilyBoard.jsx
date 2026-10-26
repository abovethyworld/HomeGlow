import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Box, Button, CircularProgress, Typography } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { API_BASE_URL } from '../utils/apiConfig.js';
import { choreDays, dueOn } from '../utils/choreDays.js';

// Family board, step 1: Today-only overview with live data, plus a read-only
// per-profile list. Tap-to-complete arrives in step 2; the 60s idle return
// arrives in step 3. Theme-neutral styling on purpose: themes land in step 4.

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
function leftSchedulesForUser(schedules, historyRows, userId, key) {
  return (schedules || [])
    .filter((s) => Number(s.user_id) === Number(userId))
    .filter((s) => {
      const days = choreDays({ rows: historyRows, schedule: s, userId, today: key, count: 1 });
      if (days[0]?.state === 'today') return true;
      if (dueOn(s, key) !== null) return false;
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

export default function FamilyBoard() {
  const [view, setView] = useState({ name: 'overview' });
  const [users, setUsers] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [historyRows, setHistoryRows] = useState([]);
  const [events, setEvents] = useState([]);
  const [weather, setWeather] = useState(null);
  const [calendarError, setCalendarError] = useState(false);
  const [loading, setLoading] = useState(true);

  const key = useMemo(() => todayKey(), []);

  const fetchAll = useCallback(async () => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const [usersRes, schedulesRes, historyRes, eventsRes, weatherRes] = await Promise.allSettled([
      axios.get(`${API_BASE_URL}/api/users`),
      axios.get(`${API_BASE_URL}/api/chore-schedules`, { params: { visible: true } }),
      axios.get(`${API_BASE_URL}/api/chore-history`, { params: { date: key } }),
      axios.get(`${API_BASE_URL}/api/calendar-events`, {
        params: { start: start.toISOString(), end: end.toISOString() },
      }),
      // Household weather location; the key itself (WEATHER_API_KEY) is a
      // separate setting and still missing, so this stays hidden until then.
      axios.get(`${API_BASE_URL}/api/weather`, { params: { location: 'Savannah, GA' } }),
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
    setLoading(false);
  }, [key]);

  useEffect(() => {
    fetchAll();
    const timer = setInterval(fetchAll, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [fetchAll]);

  const todayEvents = useMemo(
    () => events.filter((e) => eventIsToday(e, key)),
    [events, key],
  );

  const leftByUser = useMemo(() => {
    const map = new Map();
    users.forEach((u) => map.set(u.id, leftSchedulesForUser(schedules, historyRows, u.id, key)));
    return map;
  }, [users, schedules, historyRows, key]);

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

  return (
    <ThemeProvider theme={boardTheme}>
      <Box sx={{ minHeight: '100vh', px: 3, py: 3, boxSizing: 'border-box' }}>
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
            <Typography variant="h3" sx={{ fontWeight: 700, mb: 1 }}>
              {profile.username}
            </Typography>
            <Typography variant="h5" sx={{ mb: 3, color: 'text.secondary' }}>
              {profileLeft.length === 0 ? 'Nothing left today' : `${profileLeft.length} left today`}
            </Typography>
            {profileLeft.length === 0 ? (
              <Typography variant="h6" sx={{ color: 'text.secondary' }}>All done.</Typography>
            ) : (
              profileLeft.map((s) => (
                <Box key={s.id} sx={{ py: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="h5">{s.title}</Typography>
                  {s.description ? (
                    <Typography variant="body1" sx={{ color: 'text.secondary' }}>{s.description}</Typography>
                  ) : null}
                </Box>
              ))
            )}
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
                  return (
                    <Button
                      key={u.id}
                      variant="contained"
                      onClick={() => setView({ name: 'profile', userId: u.id })}
                      sx={{ minHeight: 88, fontSize: 24, justifyContent: 'space-between', px: 3 }}
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
    </ThemeProvider>
  );
}
