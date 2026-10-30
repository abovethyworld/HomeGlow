import { describe, it, expect } from 'vitest';
import { GRADIENT_PRESETS, normalizeBackground, normalizeCardOpacity, parseColor, personalizationTokens } from './personalize.js';

describe('personalizationTokens', () => {
  it('sets nothing at the defaults, so the theme shows through', () => {
    expect(personalizationTokens({ background: { kind: 'none' }, cardOpacity: 1 }, '#2a2a2a')).toEqual({});
  });

  it('turns each background kind into page tokens', () => {
    expect(personalizationTokens({ background: { kind: 'color', color: '#123456' } }, '')).toEqual({
      '--background': '#123456', '--hg-page-image': 'none',
    });
    expect(personalizationTokens({ background: { kind: 'gradient', preset: 'dusk' } }, '')['--hg-page-image']).toBe(GRADIENT_PRESETS.dusk);
    const image = personalizationTokens({ background: { kind: 'image', file: `${'a'.repeat(24)}.webp` } }, '');
    expect(image['--hg-page-image']).toMatch(/^url\(".*\/api\/appearance\/backgrounds\/a{24}\.webp"\)$/);
    expect(image['--hg-page-image-size']).toBe('cover');
  });

  it('turns a video background into the tokens the video layer reads', () => {
    const tokens = personalizationTokens({
      background: {
        kind: 'video',
        src: '/Uploads/wallpapers/2902931482/aquarium.mp4',
        poster: '/Uploads/wallpapers/2902931482/preview.gif',
      },
    }, '');
    expect(tokens['--hg-page-image']).toBe('none');
    expect(tokens['--hg-bg-video']).toBe('url("/Uploads/wallpapers/2902931482/aquarium.mp4")');
    expect(tokens['--hg-bg-video-poster']).toBe('url("/Uploads/wallpapers/2902931482/preview.gif")');
  });

  it('scales the frame background the theme resolved to', () => {
    expect(personalizationTokens({ cardOpacity: 0.5 }, '#2a2a2a')['--hg-frame-bg']).toBe('rgba(42, 42, 42, 0.5)');
    expect(personalizationTokens({ cardOpacity: 0.5 }, 'rgba(250, 255, 255, 0.72)')['--hg-frame-bg']).toBe('rgba(250, 255, 255, 0.36)');
    expect(personalizationTokens({ cardOpacity: 0.5 }, 'not a color')).toEqual({});
  });
});

describe('normalizeBackground video kind', () => {
  const src = '/Uploads/wallpapers/2902931482/aquarium.mp4';
  it('keeps an imported wallpaper video and its poster', () => {
    expect(normalizeBackground({ kind: 'video', src, poster: '/Uploads/wallpapers/2902931482/preview.gif' }))
      .toEqual({ kind: 'video', src, poster: '/Uploads/wallpapers/2902931482/preview.gif' });
  });

  it('drops a poster that is not a still from the same uploads area', () => {
    expect(normalizeBackground({ kind: 'video', src, poster: 'https://example.com/x.gif' })).toEqual({ kind: 'video', src });
  });

  it('rejects video files outside the wallpaper imports', () => {
    expect(normalizeBackground({ kind: 'video', src: 'https://example.com/movie.mp4' })).toBeUndefined();
    expect(normalizeBackground({ kind: 'video', src: '/Uploads/users/movie.mp4' })).toBeUndefined();
    expect(normalizeBackground({ kind: 'video', src: '/Uploads/wallpapers/2902931482/notes.txt' })).toBeUndefined();
  });
});

describe('helpers', () => {
  it('parses hex and rgb colors', () => {
    expect(parseColor('#fff')).toEqual([255, 255, 255, 1]);
    expect(parseColor('rgb(1, 2, 3)')).toEqual([1, 2, 3, 1]);
    expect(parseColor('var(--x)')).toBeNull();
  });

  it('clamps card opacity to the allowed range', () => {
    expect(normalizeCardOpacity(0.1)).toBe(0.7);
    expect(normalizeCardOpacity(2)).toBe(1);
    expect(normalizeCardOpacity('x')).toBeUndefined();
  });
});

describe('scene backgrounds', () => {
  it('accepts a wallpaper preview as a scene background', () => {
    expect(normalizeBackground({ kind: 'scene', src: '/Uploads/wallpapers/2984957363/preview.gif' }))
      .toEqual({ kind: 'scene', src: '/Uploads/wallpapers/2984957363/preview.gif' });
    expect(normalizeBackground({ kind: 'scene', src: '/Uploads/wallpapers/sleep-token-fallen-leaves/preview.gif' }))
      .toEqual({ kind: 'scene', src: '/Uploads/wallpapers/sleep-token-fallen-leaves/preview.gif' });
  });

  it('rejects scene files outside the wallpaper packages', () => {
    expect(normalizeBackground({ kind: 'scene', src: '/Uploads/photos/cat.gif' })).toBeUndefined();
    expect(normalizeBackground({ kind: 'scene', src: '/Uploads/wallpapers/2902931482/aquarium.mp4' })).toBeUndefined();
    expect(normalizeBackground({ kind: 'scene', src: 'https://example.com/x.gif' })).toBeUndefined();
  });

  it('hands the scene file to the SceneBackground layer', () => {
    const tokens = personalizationTokens({ background: { kind: 'scene', src: '/Uploads/wallpapers/2984957363/preview.gif' }, cardOpacity: 1 }, '#ffffff');
    expect(tokens['--hg-bg-scene']).toBe('url("/Uploads/wallpapers/2984957363/preview.gif")');
    expect(tokens['--hg-page-image']).toBe('none');
  });

  it('accepts an animated rebuild with the still as its poster', () => {
    expect(normalizeBackground({
      kind: 'scene',
      src: '/Uploads/wallpapers/2984957363/animated.webp',
      poster: '/Uploads/wallpapers/2984957363/still.jpg',
    })).toEqual({
      kind: 'scene',
      src: '/Uploads/wallpapers/2984957363/animated.webp',
      poster: '/Uploads/wallpapers/2984957363/still.jpg',
    });
  });

  it('drops a scene poster that is not a wallpaper package file', () => {
    expect(normalizeBackground({
      kind: 'scene',
      src: '/Uploads/wallpapers/2984957363/animated.webp',
      poster: 'https://example.com/x.jpg',
    })).toEqual({ kind: 'scene', src: '/Uploads/wallpapers/2984957363/animated.webp' });
  });

  it('hands the scene poster to the SceneBackground layer', () => {
    const tokens = personalizationTokens({
      background: {
        kind: 'scene',
        src: '/Uploads/wallpapers/2984957363/animated.webp',
        poster: '/Uploads/wallpapers/2984957363/still.jpg',
      },
      cardOpacity: 1,
    }, '#ffffff');
    expect(tokens['--hg-bg-scene']).toBe('url("/Uploads/wallpapers/2984957363/animated.webp")');
    expect(tokens['--hg-bg-scene-poster']).toBe('url("/Uploads/wallpapers/2984957363/still.jpg")');
  });
});
