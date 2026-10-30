import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Box, Button } from '@mui/material';
import { API_BASE_URL } from '../utils/apiConfig.js';
import { getDeviceApiBase } from '../utils/deviceName.js';
import { saveAppearanceFields } from '../utils/appearanceSave.js';
import { WAKE_PROFILE_PICK_EVENT } from '../utils/idleFade.js';
import WallpaperPicker from './WallpaperPicker.jsx';

// The machinery behind "who is looking" for this display, plus the
// small utility row at the top of the dashboard. Applying a member
// writes this display's appearance overrides (that member's
// wallpaper as the background, their palette as the interface
// colors, light and dark), so the whole dashboard takes their look.
// The household appearance itself is never touched. Same save path
// and refresh event the Admin panel uses.
//
// If the member has a device setup linked to their profile, applying
// them also applies that setup's tabs/widgets configuration to this
// display. app.jsx refetches tabs and assignments on the
// config-updated event.
//
// The row itself no longer offers the members or a Default button
// (Gavin's call after trying the wake flow): picking who is looking
// happens only at the wake picker, and the way back there is Sleep.
// The row keeps Sleep and the Wallpapers browser; this component
// still owns the member set and the apply path because the wake
// picker (components/WakePicker.jsx) picks through it.
const DEVICE_SETTINGS_UPDATED_EVENT = 'homeglow:device-settings-updated';
const DEVICE_CONFIG_UPDATED_EVENT = 'homeglow:device-config-updated';
const PLUGIN_ID = 'wallpaper-engine';

export function backgroundFor(pkg) {
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

// A member's profile photo, served the same way the chore widget
// serves it (users.profile_picture relative to /Uploads/users/, or a
// data URL). Null when the member has no photo; the circle then falls
// back to their initial.
export function profilePhotoUrl(user) {
  const pic = user?.profile_picture;
  if (!pic) return null;
  return pic.startsWith('data:') ? pic : `${API_BASE_URL}/Uploads/users/${pic}`;
}

export default function ProfileSwitcher({ faded = false, onSleep }) {
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
    // Only a member pick carries a profile, so only it can apply a
    // linked setup.
    if (entry) {
      void applyProfileSetup(entry.user.id);
    }
  };

  // The wake picker (components/WakePicker.jsx) shows the same
  // members big, over the idle wallpaper. A pick there arrives as a
  // window event with the member's user id and runs through this
  // exact apply path, so waking into a side and tapping its circle
  // here can never drift apart. Refs keep the listener bound once
  // while always seeing the latest members and apply.
  const membersRef = React.useRef(members);
  membersRef.current = members;
  const applyRef = React.useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    const onWakePick = (event) => {
      const entry = membersRef.current.find((m) => m.user.id === event.detail?.userId);
      if (entry) applyRef.current(entry);
    };
    window.addEventListener(WAKE_PROFILE_PICK_EVENT, onWakePick);
    return () => window.removeEventListener(WAKE_PROFILE_PICK_EVENT, onWakePick);
  }, []);

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
        // Its own row at the top of the dashboard, in normal flow: the
        // widget grid starts below it, so the chips can never cover a
        // widget's header controls (the settings gear lives up there).
        // When the chips wrap on a narrow screen the row grows taller
        // and pushes the grid down with it. It used to be position:fixed
        // at the top-right corner, floating over the first widget row.
        // position:relative + zIndex keeps the row IN flow (it still
        // reserves its height) while painting above the wallpaper
        // background layers (video/scene), which are position:fixed
        // with no zIndex and would otherwise cover a plain row: the
        // first in-flow version was invisible under the scene image.
        position: 'relative',
        zIndex: 1100,
        display: 'flex',
        gap: 1,
        flexWrap: 'wrap',
        justifyContent: 'flex-end',
        px: 1.5,
        pt: 1.5,
        // The idle fade (utils/idleFade.js): the row melts away with
        // the widgets, leaving only the wallpaper. It stays mounted
        // and keeps its height, so waking never shifts the layout.
        opacity: faded ? 0 : 1,
        pointerEvents: faded ? 'none' : 'auto',
        transition: 'opacity 600ms ease',
      }}
    >
      {onSleep && (
        <Button disabled={busy} onClick={onSleep} sx={chipSx(false, null)}>
          Sleep
        </Button>
      )}
      <Button disabled={busy} onClick={() => setPickerOpen(true)} sx={chipSx(false, null)}>
        Wallpapers
      </Button>
      <WallpaperPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onShowPackage={(pkg) => applyPackage(pkg)}
      />
    </Box>
  );
}
