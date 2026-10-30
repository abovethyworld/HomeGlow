import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  Box, Button, Card, CardActions, CardContent, CardMedia, Chip,
  Dialog, DialogContent, DialogTitle, Typography,
} from '@mui/material';
import { API_BASE_URL } from '../utils/apiConfig.js';

// The wallpaper picker: every package the importer knows, as a card
// with its preview thumbnail (the preview's one legitimate job).
// From a card: Show puts it on this screen now; the assign row makes
// it someone's saved pick, or the household default. Dropping a
// Wallpaper Engine zip at the top imports it on the spot; the rules
// (full-res art only, never the thumbnail) are the server's job.
const INTERFACE_SETTINGS_UPDATED_EVENT = 'homeglow:interface-settings-updated';
const PLUGIN_ID = 'wallpaper-engine';

export default function WallpaperPicker({ open, onClose, onShowPackage }) {
  const [packages, setPackages] = useState([]);
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(null);
  const fileRef = useRef(null);

  const refresh = useCallback(async () => {
    const [storeRes, usersRes] = await Promise.allSettled([
      axios.get(`${API_BASE_URL}/api/plugin/v1/storage/${PLUGIN_ID}`),
      axios.get(`${API_BASE_URL}/api/users`),
    ]);
    if (storeRes.status === 'fulfilled') {
      const store = storeRes.value.data || {};
      setPackages(Array.isArray(store.packages) ? store.packages : []);
    }
    if (usersRes.status === 'fulfilled' && Array.isArray(usersRes.value.data)) {
      setUsers(usersRes.value.data.filter((u) => u.id !== 0));
    }
  }, []);

  useEffect(() => {
    if (open) {
      setError(null);
      setConfirmRemove(null);
      refresh();
    }
  }, [open, refresh]);

  const importZip = async (file) => {
    if (!file) return;
    setBusy('import');
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await axios.post(`${API_BASE_URL}/api/wallpapers/import`, form);
      setPackages(data.packages || []);
      window.dispatchEvent(new Event('homeglow:wallpapers-changed'));
    } catch (e) {
      setError(e?.response?.data?.error || 'That zip would not import.');
    } finally {
      setBusy('');
    }
  };

  const assign = async (pkg, target) => {
    setBusy(`assign-${pkg.id}`);
    setError(null);
    try {
      const { data } = await axios.post(`${API_BASE_URL}/api/wallpapers/assign`, {
        packageId: pkg.id,
        target,
      });
      setPackages(data.packages || packages);
      window.dispatchEvent(new Event('homeglow:wallpapers-changed'));
      if (target === 'default') window.dispatchEvent(new Event(INTERFACE_SETTINGS_UPDATED_EVENT));
    } catch (e) {
      setError(e?.response?.data?.error || 'That assignment would not save.');
    } finally {
      setBusy('');
    }
  };

  const remove = async (pkg) => {
    setBusy(`remove-${pkg.id}`);
    try {
      const { data } = await axios.delete(`${API_BASE_URL}/api/wallpapers/${pkg.id}`);
      setPackages(data.packages || []);
      window.dispatchEvent(new Event('homeglow:wallpapers-changed'));
      setConfirmRemove(null);
    } catch (e) {
      setError(e?.response?.data?.error || 'That wallpaper would not remove.');
    } finally {
      setBusy('');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Wallpapers</DialogTitle>
      <DialogContent>
        <Box
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            importZip(e.dataTransfer.files?.[0]);
          }}
          onClick={() => fileRef.current?.click()}
          sx={{
            border: '2px dashed', borderColor: 'divider', borderRadius: 2,
            p: 3, mb: 2, textAlign: 'center', cursor: 'pointer',
          }}
        >
          <Typography variant="h6">
            {busy === 'import' ? 'Importing... a big video can take a few minutes' : 'Drop a Wallpaper Engine zip here, or tap to choose one'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            It unpacks itself: video or scene, full-size art, colors pulled from the wallpaper.
          </Typography>
          <input
            ref={fileRef}
            type="file"
            accept=".zip"
            hidden
            onChange={(e) => {
              importZip(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </Box>
        {error ? (
          <Typography sx={{ mb: 2, color: 'error.main' }}>{error}</Typography>
        ) : null}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 2 }}>
          {packages.map((pkg) => (
            <Card key={pkg.id} variant="outlined">
              {pkg.preview ? (
                <CardMedia component="img" height="120" image={pkg.preview} alt="" />
              ) : null}
              <CardContent sx={{ pb: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.25 }}>
                  {pkg.title}
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
                  <Chip size="small" label={pkg.type === 'video' ? 'Video' : 'Scene'} />
                  <Chip size="small" variant="outlined" label={pkg.owner ? pkg.owner : 'Unassigned'} />
                  {pkg.needsShrink ? <Chip size="small" variant="outlined" label="HD version processing" /> : null}
                </Box>
              </CardContent>
              <CardActions sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                <Button size="small" variant="contained" onClick={() => { onShowPackage(pkg); onClose(); }}>
                  Show
                </Button>
                <Button size="small" disabled={busy !== ''} onClick={() => assign(pkg, 'default')}>
                  Make default
                </Button>
                {users.map((u) => (
                  <Button
                    key={u.id}
                    size="small"
                    disabled={busy !== ''}
                    variant={Number(pkg.ownerProfileId) === Number(u.id) ? 'outlined' : 'text'}
                    onClick={() => assign(pkg, u.id)}
                  >
                    {u.username}
                  </Button>
                ))}
                <Button
                  size="small"
                  color="error"
                  disabled={busy !== ''}
                  onClick={() => (confirmRemove === pkg.id ? remove(pkg) : setConfirmRemove(pkg.id))}
                >
                  {confirmRemove === pkg.id ? 'Tap again to remove' : 'Remove'}
                </Button>
              </CardActions>
            </Card>
          ))}
        </Box>
        {packages.length === 0 ? (
          <Typography color="text.secondary">No wallpapers yet. Drop the first zip above.</Typography>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
