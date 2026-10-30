import React, { useEffect, useState } from 'react';
import { THEME_TOKENS_APPLIED_EVENT } from '../utils/pluginThemeBridge.js';

// The scene half of a personalization background (utils/personalize.js,
// kind "scene"): a wallpaper's animated rebuild painted behind the
// widgets, in the same layer position as the video background. The
// personalization tokens carry the file as the --hg-bg-scene custom
// property and its still as --hg-bg-scene-poster; this layer reads
// them back whenever app.jsx reapplies the tokens, which is also how
// it learns the setting changed.
function readUrlVar(name) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const match = raw.match(/^url\(["']?(.*?)["']?\)$/);
  return match ? match[1] : '';
}

function readBackground() {
  return {
    src: readUrlVar('--hg-bg-scene'),
    poster: readUrlVar('--hg-bg-scene-poster'),
  };
}

export default function SceneBackground() {
  const [background, setBackground] = useState(readBackground);

  useEffect(() => {
    const update = () => setBackground(readBackground());
    update();
    window.addEventListener(THEME_TOKENS_APPLIED_EVENT, update);
    return () => window.removeEventListener(THEME_TOKENS_APPLIED_EVENT, update);
  }, []);

  if (!background.src) return null;

  const layerStyle = {
    position: 'fixed',
    inset: 0,
    width: '100vw',
    height: '100%',
    objectFit: 'cover',
    pointerEvents: 'none',
  };

  // Reduced motion gets the still, never the animation.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (!background.poster) return null;
    return <img src={background.poster} alt="" aria-hidden="true" style={layerStyle} />;
  }

  return (
    <img
      key={background.src}
      src={background.src}
      alt=""
      aria-hidden="true"
      style={layerStyle}
    />
  );
}
