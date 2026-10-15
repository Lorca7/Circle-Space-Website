'use strict';

/**
 * Turns a pasted video URL into something embeddable.
 * Unrecognised hosts are kept as a plain outbound link rather than rejected,
 * so the owner is never blocked from saving a video.
 */
function parseVideoUrl(raw) {
  const input = String(raw ?? '').trim();
  if (!input) return { ok: false, error: 'Paste a video link first.' };

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return { ok: false, error: 'That does not look like a valid link.' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Only http and https links are supported.' };
  }

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();

  // --- YouTube ---------------------------------------------------------
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const id = url.searchParams.get('v');
    if (id && isYouTubeId(id)) {
      return embed('youtube', id, `https://www.youtube-nocookie.com/embed/${id}`, url.href);
    }
    const parts = url.pathname.split('/').filter(Boolean);
    // /embed/ID, /shorts/ID, /live/ID, /v/ID
    if (parts.length >= 2 && ['embed', 'shorts', 'live', 'v'].includes(parts[0])) {
      if (isYouTubeId(parts[1])) {
        return embed('youtube', parts[1], `https://www.youtube-nocookie.com/embed/${parts[1]}`, url.href);
      }
    }
  }
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    if (id && isYouTubeId(id)) {
      return embed('youtube', id, `https://www.youtube-nocookie.com/embed/${id}`, url.href);
    }
  }

  // --- Vimeo -----------------------------------------------------------
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = url.pathname.split('/').filter(Boolean).find((p) => /^\d+$/.test(p));
    if (id) {
      return embed('vimeo', id, `https://player.vimeo.com/video/${id}`, url.href);
    }
  }

  return { ok: true, provider: 'link', videoId: '', embedUrl: '', url: url.href };
}

function isYouTubeId(id) {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

function embed(provider, videoId, embedUrl, url) {
  return { ok: true, provider, videoId, embedUrl, url };
}

/** Rebuilds the embed URL for a row already in the database. */
function embedUrlFor(video) {
  if (video.provider === 'youtube' && video.video_id) {
    return `https://www.youtube-nocookie.com/embed/${video.video_id}`;
  }
  if (video.provider === 'vimeo' && video.video_id) {
    return `https://player.vimeo.com/video/${video.video_id}`;
  }
  return '';
}

module.exports = { parseVideoUrl, embedUrlFor };
