import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Avatar, Box, Button, Typography } from '@mui/material';
import { API_BASE_URL } from '../utils/apiConfig.js';
import { backgroundFor, profilePhotoUrl } from './ProfileSwitcher.jsx';

// The wake screen for the idle dashboard (fork, Gavin's design): when
// the idle wallpaper is woken, the dashboard does NOT come back on a
// default page. The only thing on screen is one big photo circle per
// family member, name under it, over the wallpaper. Tapping a circle
// loads that member's side (the profile switcher hears the pick and
// runs its apply, see utils/idleFade.js); no household option and
// nothing else. If nobody taps, the wake cycle drifts back to the
// wallpaper on its own.
//
// The member set matches the profile switcher exactly (members whose
// wallpaper the Wallpaper Engine plugin tracks), so a circle here
// always has a side to load. With no members at all there is nothing
// to pick, so onEmpty lets the caller skip the picker instead of
// trapping the display on an empty screen.
const PLUGIN_ID = 'wallpaper-engine';

export default function WakePicker({ visible = false, onPick, onEmpty }) {
  const [users, setUsers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const fetchData = React.useCallback(async () => {
    const [usersRes, storeRes] = await Promise.allSettled([
      axios.get(`${API_BASE_URL}/api/users`),
      axios.get(`${API_BASE_URL}/api/plugin/v1/storage/${PLUGIN_ID}`),
    ]);
    if (usersRes.status === 'fulfilled' && Array.isArray(usersRes.value.data)) {
      setUsers(usersRes.value.data.filter((u) => u.id !== 0));
    }
    if (storeRes.status === 'fulfilled') {
      const store = storeRes.value.data || {};
      setPackages(Array.isArray(store.packages) ? store.packages : []);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    fetchData();
    window.addEventListener('homeglow:wallpapers-changed', fetchData);
    return () => window.removeEventListener('homeglow:wallpapers-changed', fetchData);
  }, [fetchData]);

  const members = useMemo(
    () => users
      .map((user) => ({ user, pkg: packages.find((p) => Number(p.ownerProfileId) === Number(user.id)) || null }))
      .filter((entry) => entry.pkg && backgroundFor(entry.pkg)),
    [users, packages],
  );

  // Nothing to pick: tell the caller once per showing, so the wake
  // goes straight to the dashboard rather than an empty picker.
  const emptyToldRef = useRef(false);
  useEffect(() => {
    if (!visible) {
      emptyToldRef.current = false;
      return;
    }
    if (loaded && members.length === 0 && !emptyToldRef.current) {
      emptyToldRef.current = true;
      onEmpty?.();
    }
  }, [visible, loaded, members, onEmpty]);

  return (
    <Box
      data-testid="wake-picker"
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 1250,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // A soft shade behind the circles only, so photos and names
        // stay readable on a bright wallpaper; the wallpaper itself
        // still fills the screen around it.
        background: 'radial-gradient(circle at center, rgba(30, 30, 34, 0.42), transparent 62%)',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'opacity 400ms ease',
      }}
    >
      <Box sx={{ display: 'flex', gap: { xs: 3, sm: 6 }, px: 2 }}>
        {members.map((entry) => {
          const accent = entry.pkg.palette?.accent || null;
          return (
            <Button
              key={entry.user.id}
              onClick={() => onPick?.(entry.user.id)}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1.25,
                px: 1.5,
                py: 1.5,
                borderRadius: 4,
                textTransform: 'none',
                '&:hover': { backgroundColor: 'transparent' },
              }}
            >
              <Avatar
                src={profilePhotoUrl(entry.user) || undefined}
                alt={entry.user.username}
                sx={{
                  width: { xs: 92, sm: 124 },
                  height: { xs: 92, sm: 124 },
                  bgcolor: accent || 'rgba(30, 30, 34, 0.72)',
                  color: '#fff',
                  fontSize: 44,
                  fontWeight: 700,
                  boxShadow: '0 0 0 2px var(--hg-white-30), 0 10px 32px var(--hg-black-70)',
                }}
              >
                {entry.user.username.charAt(0)}
              </Avatar>
              <Typography
                sx={{
                  color: '#fff',
                  fontSize: { xs: 17, sm: 21 },
                  fontWeight: 600,
                  lineHeight: 1.1,
                  textShadow: '0 1px 4px var(--hg-black-70)',
                }}
              >
                {entry.user.username}
              </Typography>
            </Button>
          );
        })}
      </Box>
    </Box>
  );
}
