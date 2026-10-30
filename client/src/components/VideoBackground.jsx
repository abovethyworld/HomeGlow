import React, { useEffect, useRef, useState } from 'react';
import { THEME_TOKENS_APPLIED_EVENT } from '../utils/pluginThemeBridge.js';

// The video half of a personalization background (utils/personalize.js,
// kind "video"): a muted looping video behind the widgets, in the same
// layer position as the theme ambience. The personalization tokens carry
// the file as the --hg-bg-video custom property; this layer reads it back
// whenever app.jsx reapplies the tokens, which is also how it learns the
// setting changed. Files are wallpaper packages the Wallpaper Engine
// plugin imported, served by /Uploads with range support, so playback
// streams instead of downloading the whole file first.
function readUrlVar(name) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const match = raw.match(/^url\(["']?(.*?)["']?\)$/);
  return match ? match[1] : '';
}

function readBackground() {
  return {
    src: readUrlVar('--hg-bg-video'),
    poster: readUrlVar('--hg-bg-video-poster'),
  };
}

export default function VideoBackground() {
  const [background, setBackground] = useState(readBackground);
  const videoRef = useRef(null);

  useEffect(() => {
    const update = () => setBackground(readBackground());
    update();
    window.addEventListener(THEME_TOKENS_APPLIED_EVENT, update);
    return () => window.removeEventListener(THEME_TOKENS_APPLIED_EVENT, update);
  }, []);

  // A wall display should not decode video nobody is looking at.
  useEffect(() => {
    const onVisibility = () => {
      const video = videoRef.current;
      if (!video) return;
      if (document.hidden) video.pause();
      else video.play().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [background.src]);

  if (!background.src) return null;

  const layerStyle = {
    position: 'fixed',
    top: 0,
    bottom: 0,
    left: 0,
    width: '100vw',
    height: '100%',
    objectFit: 'cover',
    pointerEvents: 'none',
  };

  // Reduced motion gets the still, never the video.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (!background.poster) return null;
    return <img src={background.poster} alt="" aria-hidden="true" style={layerStyle} />;
  }

  return (
    <video
      key={background.src}
      ref={videoRef}
      src={background.src}
      poster={background.poster || undefined}
      autoPlay
      muted
      loop
      playsInline
      aria-hidden="true"
      style={layerStyle}
    />
  );
}
