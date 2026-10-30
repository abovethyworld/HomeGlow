import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Box, Button } from '@mui/material';
import { API_BASE_URL } from '../utils/apiConfig.js';
import { getDeviceApiBase } from '../utils/deviceName.js';
import { saveAppearanceFields } from '../utils/appearanceSave.js';
import WallpaperPicker from './WallpaperPicker.jsx';

// "Who is looking" for this display: a chip per family member whose
// wallpaper the Wallpaper Engine plugin tracks. Tapping one writes
// this display's appearance overrides (that member's wallpaper as the
// background, their palette as the interface colors, light and dark),
// so the whole dashboard takes their look; Default drops the
// overrides and the household look returns. The household appearance
// itself is never touched. Same save path and refresh event the
// Admin panel uses.
//
// If the tapped member has a device setup linked to their profile,
// the tap also applies that setup's tabs/widgets configuration to
// this display (an explicit action, like the appearance change).
// app.jsx refetches tabs and assignments on the config-updated event.
const DEVICE_SETTINGS_UPDATED_EVENT = 'homeglow:device-settings-updated';
const DEVICE_CONFIG_UPDATED_EVENT = 'homeglow:device-config-updated';
const PLUGIN_ID = 'wallpaper-engine';

function backgroundFor(pkg) {
  if (!pkg) return null;
  if (pkg.type === 'video' && pkg.video) return { kind: 'video', src: pkg.video, poster: pkg.preview || undefined };
  // A scene plays its animated rebuild when one exists; the
  // full-resolution still (extracted from the scene's own art) is
  // the poster and the fallback, and the 160px preview is only a
  // last resort.
  if (pkg.animated || pkg.still || pkg.preview) {
    const scene = { kind: 'scene', src: pkg.animated || pkg.still || pkg.preview };
    if (pkg.still && pkg.still !== scene.src) scene.poster = pkg.still;
    return scene;
  }
  return null;
}

export default function ProfileSwitcher({ appearance }) {
  const [users, setUsers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

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
  }, []);

  useEffect(() => {
    fetchData();
    // The picker changes the package set (imports, assignments);
    // refetch so the chips never go stale.
    window.addEventListener('homeglow:wallpapers-changed', fetchData);
    return () => window.removeEventListener('homeglow:wallpapers-changed', fetchData);
  }, [fetchData]);

  const members = useMemo(
    () => users
      .map((user) => ({ user, pkg: packages.find((p) => Number(p.ownerProfileId) === Number(user.id)) || null }))
      .filter((entry) => entry.pkg && backgroundFor(entry.pkg)),
    [users, packages],
  );

  const activeId = useMemo(() => {
    const src = appearance?.background?.src;
    if (!src) return null;
    const hit = members.find(({ pkg }) => pkg.video === src || pkg.preview === src || pkg.animated === src || pkg.still === src);
    return hit ? hit.user.id : null;
  }, [appearance, members]);

  const applyPackage = async (pkg) => {
    if (busy) return;
    setBusy(true);
    try {
      if (!pkg) {
        await saveAppearanceFields('device', {}, { useHousehold: ['background', 'colors', 'colorsDark'] });
      } else {
        const partial = { background: backgroundFor(pkg) };
        if (pkg.palette?.light) partial.colors = pkg.palette.light;
        if (pkg.palette?.dark) partial.colorsDark = pkg.palette.dark;
        await saveAppearanceFields('device', partial);
      }
      window.dispatchEvent(new Event(DEVICE_SETTINGS_UPDATED_EVENT));
    } catch {
      // A failed save leaves the current look in place; the next tap retries.
    } finally {
      setBusy(false);
    }
  };

  const applyProfileSetup = async (userId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/device-setups`);
      const linked = Array.isArray(response.data)
        ? response.data.find((setup) => setup.profileUserId === userId)
        : null;
      if (!linked) return;
      await axios.post(`${getDeviceApiBase(API_BASE_URL)}/apply-setup/${linked.id}`);
      window.dispatchEvent(new Event(DEVICE_CONFIG_UPDATED_EVENT));
    } catch {
      // A failed apply leaves the current configuration in place.
    }
  };

  const apply = (entry) => {
    void applyPackage(entry ? entry.pkg : null);
    // Only a member tap carries a profile, so only it can apply a
    // linked setup; Default never touches the configuration.
    if (entry) {
      void applyProfileSetup(entry.user.id);
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
      <Button disabled={busy} onClick={() => setPickerOpen(true)} sx={chipSx(false, null)}>
        Wallpapers
      </Button>
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
      <WallpaperPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onShowPackage={(pkg) => applyPackage(pkg)}
      />
    </Box>
  );
}
