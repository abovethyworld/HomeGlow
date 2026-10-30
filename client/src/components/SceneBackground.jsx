import React, { useEffect, useState } from 'react';
import { THEME_TOKENS_APPLIED_EVENT } from '../utils/pluginThemeBridge.js';

// The scene half of a personalization background (utils/personalize.js,
// kind "scene"): a wallpaper's animated preview painted behind the
// widgets, in the same layer position as the video background. The
// personalization tokens carry the file as the --hg-bg-scene custom
// property; this layer reads it back whenever app.jsx reapplies the
// tokens, which is also how it learns the setting changed.
function readSceneSrc() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--hg-bg-scene').trim();
  const match = raw.match(/^url\(["']?(.*?)["']?\)$/);
  return match ? match[1] : '';
}

export default function SceneBackground() {
  const [src, setSrc] = useState(readSceneSrc);

  useEffect(() => {
    const update = () => setSrc(readSceneSrc());
    update();
    window.addEventListener(THEME_TOKENS_APPLIED_EVENT, update);
    return () => window.removeEventListener(THEME_TOKENS_APPLIED_EVENT, update);
  }, []);

  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100%',
        objectFit: 'cover',
        pointerEvents: 'none',
      }}
    />
  );
}
