import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Box, Button } from '@mui/material';
import { API_BASE_URL } from '../utils/apiConfig.js';
import { saveAppearanceFields } from '../utils/appearanceSave.js';

// "Who is looking" for this display: a chip per family member whose
// wallpaper the Wallpaper Engine plugin tracks. Tapping one writes
// this display's appearance overrides (that member's wallpaper as the
// background, their palette as the interface colors, light and dark),
// so the whole dashboard takes their look; Default drops the
// overrides and the household look returns. The household appearance
// itself is never touched. Same save path and refresh event the
// Admin panel uses.
const DEVICE_SETTINGS_UPDATED_EVENT = 'homeglow:device-settings-updated';
const PLUGIN_ID = 'wallpaper-engine';

function backgroundFor(pkg) {
  if (!pkg) return null;
  if (pkg.type === 'video' && pkg.video) return { kind: 'video', src: pkg.video, poster: pkg.preview || undefined };
  // A scene wears its full-resolution still (extracted from the scene's
  // own art); the 160px preview is only a fallback.
  if (pkg.still || pkg.preview) return { kind: 'scene', src: pkg.still || pkg.preview };
  return null;
}

export default function ProfileSwitcher({ appearance }) {
  const [users, setUsers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [usersRes, storeRes] = await Promise.allSettled([
        axios.get(`${API_BASE_URL}/api/users`),
        axios.get(`${API_BASE_URL}/api/plugin/v1/storage/${PLUGIN_ID}`),
      ]);
      if (cancelled) return;
      if (usersRes.status === 'fulfilled' && Array.isArray(usersRes.value.data)) {
        setUsers(usersRes.value.data.filter((u) => u.id !== 0));
      }
      if (storeRes.status === 'fulfilled') {
        const store = storeRes.value.data || {};
        setPackages(Array.isArray(store.packages) ? store.packages : []);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const members = useMemo(
    () => users
      .map((user) => ({ user, pkg: packages.find((p) => Number(p.ownerProfileId) === Number(user.id)) || null }))
      .filter((entry) => entry.pkg && backgroundFor(entry.pkg)),
    [users, packages],
  );

  const activeId = useMemo(() => {
    const src = appearance?.background?.src;
    if (!src) return null;
    const hit = members.find(({ pkg }) => pkg.video === src || pkg.preview === src);
    return hit ? hit.user.id : null;
  }, [appearance, members]);

  if (members.length === 0) return null;

  const apply = async (entry) => {
    if (busy) return;
    setBusy(true);
    try {
      if (!entry) {
        await saveAppearanceFields('device', {}, { useHousehold: ['background', 'colors', 'colorsDark'] });
      } else {
        const partial = { background: backgroundFor(entry.pkg) };
        if (entry.pkg.palette?.light) partial.colors = entry.pkg.palette.light;
        if (entry.pkg.palette?.dark) partial.colorsDark = entry.pkg.palette.dark;
        await saveAppearanceFields('device', partial);
      }
      window.dispatchEvent(new Event(DEVICE_SETTINGS_UPDATED_EVENT));
    } catch {
      // A failed save leaves the current look in place; the next tap retries.
    } finally {
      setBusy(false);
    }
  };

  const chipSx = (isActive, accent) => ({
    minHeight: 44,
    px: 2,
    borderRadius: 999,
    fontSize: 15,
    fontWeight: 600,
    color: '#fff',
    backgroundColor: accent || 'rgba(30, 30, 34, 0.72)',
    opacity: isActive ? 1 : 0.82,
    outline: isActive ? '2px solid #fff' : 'none',
    backdropFilter: 'blur(4px)',
    '&:hover': { backgroundColor: accent || 'rgba(30, 30, 34, 0.72)', opacity: 1 },
  });

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 12,
        right: 12,
        zIndex: 1200,
        display: 'flex',
        gap: 1,
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
      }}
    >
      <Button disabled={busy} onClick={() => apply(null)} sx={chipSx(activeId === null, null)}>
        Default
      </Button>
      {members.map((entry) => (
        <Button
          key={entry.user.id}
          disabled={busy}
          onClick={() => apply(entry)}
          sx={chipSx(activeId === entry.user.id, entry.pkg.palette?.accent || null)}
        >
          {entry.user.username}
        </Button>
      ))}
    </Box>
  );
}
