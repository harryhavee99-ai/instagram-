import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const PORT = 3000;
const DATA_DIR = path.resolve(process.cwd(), '.data');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(PROJECTS_FILE)) {
    fs.writeFileSync(PROJECTS_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
}

function readStoredProjects(): unknown[] {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(PROJECTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStoredProjects(projects: unknown[]) {
  ensureDataDir();
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), 'utf-8');
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isSafePublicHttpUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    if (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '0.0.0.0' ||
      h === '::1' ||
      h.endsWith('.local') ||
      h.endsWith('.internal') ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^169\.254\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function parseInstagramUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: 'Please enter an Instagram Reel, Video Post, or direct public video URL.' };
  }
  let parsed: URL;
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    parsed = new URL(withProto);
  } catch {
    return { valid: false, error: 'Malformed URL. Paste a valid https://www.instagram.com/reel/... or direct .mp4 link.' };
  }

  // Support direct public video URLs (.mp4, .mov, .webm, .m4v)
  if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(parsed.pathname) && isSafePublicHttpUrl(parsed.toString())) {
    const fileBase = parsed.pathname.split('/').filter(Boolean).pop() || 'Direct_Video.mp4';
    return {
      valid: true,
      normalizedUrl: parsed.toString(),
      shortcode: fileBase.replace(/\.[^.]+$/, '').slice(0, 28) || 'DirectVideo',
      contentType: 'Direct Video' as const,
      creatorHandle: parsed.hostname,
      directVideoUrl: parsed.toString(),
      queryParamsDetected: Array.from(parsed.searchParams.keys()),
    };
  }

  const host = parsed.hostname.toLowerCase().replace(/^m\./, '');
  if (host !== 'instagram.com' && host !== 'www.instagram.com' && host !== 'instagr.am') {
    return {
      valid: false,
      error: `Domain "${parsed.hostname}" is not an Instagram URL or direct video link. Supported: instagram.com/reel/<id>, instagram.com/p/<id>, instagram.com/tv/<id>, or direct .mp4/.webm URLs.`,
    };
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  let creatorHandle: string | undefined;
  let typeSegment: string | undefined;
  let shortcode: string | undefined;

  if (segments.length >= 2 && ['reel', 'reels', 'p', 'tv'].includes(segments[0].toLowerCase())) {
    typeSegment = segments[0].toLowerCase();
    shortcode = segments[1];
  } else if (segments.length >= 3 && ['reel', 'reels', 'p', 'tv'].includes(segments[1].toLowerCase())) {
    creatorHandle = `@${segments[0]}`;
    typeSegment = segments[1].toLowerCase();
    shortcode = segments[2];
  } else {
    return {
      valid: false,
      error: 'Could not detect a Reel, Video Post, or IGTV shortcode in this Instagram link. Expected /reel/<id> or /p/<id>.',
    };
  }

  if (!shortcode || !/^[A-Za-z0-9_-]{5,40}$/.test(shortcode)) {
    return {
      valid: false,
      error: 'The Instagram media shortcode appears invalid or incomplete.',
    };
  }

  const contentType: 'Reel' | 'Video Post' | 'IGTV' =
    typeSegment === 'p' ? 'Video Post' : typeSegment === 'tv' ? 'IGTV' : 'Reel';
  const canonicalType = typeSegment === 'reels' ? 'reel' : typeSegment;
  const normalizedUrl = `https://www.instagram.com/${canonicalType}/${shortcode}/`;
  const queryParamsDetected = Array.from(parsed.searchParams.keys());

  return {
    valid: true,
    normalizedUrl,
    shortcode,
    contentType,
    creatorHandle,
    directVideoUrl: undefined as string | undefined,
    queryParamsDetected,
  };
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function parseIsoDurationToSec(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i);
  if (!m) return undefined;
  const h = Number(m[1] || 0);
  const min = Number(m[2] || 0);
  const sec = Number(m[3] || 0);
  const total = h * 3600 + min * 60 + sec;
  return total > 0 ? total : undefined;
}

async function fetchThumbnailDataUrl(imageUrl: string | undefined): Promise<string | undefined> {
  if (!imageUrl || !isSafePublicHttpUrl(imageUrl)) return undefined;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'image/jpeg,image/png,image/webp,image/*',
        'User-Agent': 'Reel2PremiereAI-MetadataInspector/1.0',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) return undefined;
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 2_500_000) return undefined;
    return `data:${contentType};base64,${buf.toString('base64')}`;
  } catch {
    return undefined;
  }
}

async function fetchPublicOpenGraphMetadata(normalizedUrl: string): Promise<{
  title?: string;
  caption?: string;
  hashtags?: string[];
  thumbnailUrl?: string;
  thumbnailDataUrl?: string;
  directVideoUrl?: string;
  estimatedDurationSec?: number;
  authorName?: string;
  publicMetaExtracted: boolean;
}> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Reel2PremiereAI-MetadataInspector/1.0',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) return { publicMetaExtracted: false };

    const html = (await res.text()).slice(0, 120000);
    const extractMeta = (prop: string) => {
      const m =
        html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i')) ||
        html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i')) ||
        html.match(new RegExp(`<meta[^>]+name=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'));
      return m ? decodeHtmlEntities(m[1]).trim() : undefined;
    };

    let ogTitle = extractMeta('og:title');
    let ogDesc = extractMeta('og:description') || extractMeta('description');
    let ogImage = extractMeta('og:image');
    let ogVideo = extractMeta('og:video:secure_url') || extractMeta('og:video');
    let estimatedDurationSec = Number(extractMeta('video:duration') || 0) || undefined;
    let authorName: string | undefined;

    // Inspect public JSON-LD VideoObject schema when exposed
    const jsonLdMatches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
    for (const block of jsonLdMatches.slice(0, 4)) {
      const inner = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
      try {
        const obj = JSON.parse(inner);
        const list = Array.isArray(obj) ? obj : [obj];
        for (const entry of list) {
          if (!entry || typeof entry !== 'object') continue;
          if (!ogTitle && typeof entry.name === 'string') ogTitle = entry.name;
          if (!ogDesc && typeof entry.description === 'string') ogDesc = entry.description;
          if (!ogDesc && typeof entry.caption === 'string') ogDesc = entry.caption;
          if (!ogImage && typeof entry.thumbnailUrl === 'string') ogImage = entry.thumbnailUrl;
          if (!ogImage && Array.isArray(entry.thumbnailUrl) && typeof entry.thumbnailUrl[0] === 'string') {
            ogImage = entry.thumbnailUrl[0];
          }
          if (!ogVideo && typeof entry.contentUrl === 'string' && isSafePublicHttpUrl(entry.contentUrl)) {
            ogVideo = entry.contentUrl;
          }
          if (!estimatedDurationSec && typeof entry.duration === 'string') {
            estimatedDurationSec = parseIsoDurationToSec(entry.duration);
          }
          if (!authorName && entry.author?.name) {
            authorName = String(entry.author.name);
          }
        }
      } catch {
        // Ignore malformed JSON-LD blocks
      }
    }

    // Avoid treating generic login wall pages as post metadata
    const combined = `${ogTitle ?? ''} ${ogDesc ?? ''}`.toLowerCase();
    if (!ogTitle && !ogDesc && !ogImage && !ogVideo) return { publicMetaExtracted: false };
    if (combined.includes('login') && combined.includes('instagram') && !ogImage && !ogVideo) {
      return { publicMetaExtracted: false };
    }

    const hashtags = Array.from(new Set((ogDesc ?? '').match(/#[A-Za-z0-9_]+/g) ?? [])).slice(0, 14);
    if (!authorName) {
      const creatorMatch = (ogTitle ?? '').match(/^([^on(]+?)\s+on\s+Instagram/i);
      authorName = creatorMatch ? creatorMatch[1].trim() : undefined;
    }

    const thumbnailDataUrl = await fetchThumbnailDataUrl(ogImage);
    const validDirectVideo = ogVideo && isSafePublicHttpUrl(ogVideo) ? ogVideo : undefined;

    return {
      title: ogTitle,
      caption: ogDesc,
      hashtags,
      thumbnailUrl: ogImage,
      thumbnailDataUrl,
      directVideoUrl: validDirectVideo,
      estimatedDurationSec,
      authorName,
      publicMetaExtracted: Boolean(ogTitle || ogDesc || ogImage || validDirectVideo),
    };
  } catch {
    return { publicMetaExtracted: false };
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // Health & environment capability status (never leaks secrets)
  app.get('/api/status', (_req, res) => {
    const geminiConfigured = Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
    );
    const metaOembedConfigured = Boolean(process.env.META_OEMBED_TOKEN);
    res.json({
      ok: true,
      geminiConfigured,
      metaOembedConfigured,
      model: 'gemini-4-hydrogen',
    });
  });

  // Authorized Instagram URL validation + official Meta oEmbed & safe public OpenGraph metadata lookup
  app.post('/api/instagram/inspect', async (req, res) => {
    const rawUrl = String(req.body?.url ?? '');
    const parsed = parseInstagramUrl(rawUrl);

    if (!parsed.valid) {
      res.status(400).json({
        valid: false,
        url: rawUrl,
        oEmbedAvailable: false,
        oEmbedConfigured: Boolean(process.env.META_OEMBED_TOKEN),
        directVideoAvailable: false,
        accessNotice: parsed.error,
        error: parsed.error,
      });
      return;
    }

    if (parsed.contentType === 'Direct Video' && parsed.directVideoUrl) {
      res.json({
        valid: true,
        url: rawUrl,
        normalizedUrl: parsed.normalizedUrl,
        shortcode: parsed.shortcode,
        contentType: 'Direct Video',
        creatorHandle: parsed.creatorHandle,
        oEmbedAvailable: false,
        oEmbedConfigured: Boolean(process.env.META_OEMBED_TOKEN),
        directVideoAvailable: true,
        metadata: {
          title: parsed.shortcode,
          authorName: parsed.creatorHandle,
          directVideoUrl: parsed.directVideoUrl,
          providerName: 'Direct Public Video',
          aspectRatio: '9:16',
          publicMetaExtracted: true,
          queryParamsDetected: parsed.queryParamsDetected,
        },
        accessNotice:
          'Direct public video stream detected. Reel2Premiere AI will fetch and run full frame-by-frame analysis, separated clips, captions, and sound design reconstruction.',
      });
      return;
    }

    const token = process.env.META_OEMBED_TOKEN;
    if (!token) {
      // Attempt safe, non-authenticated public OpenGraph & JSON-LD inspection (never bypasses private accounts or DRM)
      const publicOg = await fetchPublicOpenGraphMetadata(parsed.normalizedUrl!);
      const directAvailable = Boolean(publicOg.directVideoUrl);

      res.json({
        valid: true,
        url: rawUrl,
        normalizedUrl: parsed.normalizedUrl,
        shortcode: parsed.shortcode,
        contentType: parsed.contentType,
        creatorHandle: parsed.creatorHandle || (publicOg.authorName ? `@${publicOg.authorName.replace(/^@/, '')}` : undefined),
        oEmbedAvailable: false,
        oEmbedConfigured: false,
        directVideoAvailable: directAvailable,
        metadata: {
          title: publicOg.title || `Instagram ${parsed.contentType} (${parsed.shortcode})`,
          caption: publicOg.caption,
          hashtags: publicOg.hashtags,
          authorName: publicOg.authorName || parsed.creatorHandle || 'Instagram Creator',
          thumbnailUrl: publicOg.thumbnailUrl,
          thumbnailDataUrl: publicOg.thumbnailDataUrl,
          directVideoUrl: publicOg.directVideoUrl,
          estimatedDurationSec: publicOg.estimatedDurationSec,
          providerName: 'Instagram',
          aspectRatio: parsed.contentType === 'Reel' ? '9:16' : 'Variable',
          publicMetaExtracted: publicOg.publicMetaExtracted,
          queryParamsDetected: parsed.queryParamsDetected,
        },
        accessNotice: directAvailable
          ? 'Public video stream and OpenGraph metadata detected. Starting full frame-by-frame, separated clips, captions, and sound design Premiere reconstruction.'
          : publicOg.publicMetaExtracted
          ? 'Instagram URL validated and public metadata extracted. Ready to build a complete downloadable Adobe Premiere Pro project with separated clips, caption layers, and sound design layers directly from this link (or upload your local MP4 for exact pixel extraction).'
          : 'Instagram URL validated. Ready to reconstruct a complete downloadable Adobe Premiere Pro project with separated clips, styled caption layers, and sound design layers directly from this link (or attach your local MP4 for frame-accurate pixel analysis).',
      });
      return;
    }

    try {
      const oembedEndpoint = `https://graph.facebook.com/v20.0/instagram_oembed?url=${encodeURIComponent(
        parsed.normalizedUrl!
      )}&access_token=${encodeURIComponent(token)}`;
      const upstream = await fetch(oembedEndpoint, {
        headers: { Accept: 'application/json' },
      });

      if (!upstream.ok) {
        const errBody = await upstream.text().catch(() => '');
        res.json({
          valid: true,
          url: rawUrl,
          normalizedUrl: parsed.normalizedUrl,
          shortcode: parsed.shortcode,
          contentType: parsed.contentType,
          creatorHandle: parsed.creatorHandle,
          oEmbedAvailable: false,
          oEmbedConfigured: true,
          directVideoAvailable: false,
          metadata: {
            title: `Instagram ${parsed.contentType} (${parsed.shortcode})`,
            authorName: parsed.creatorHandle ?? 'Unavailable (Private or Restricted)',
            providerName: 'Instagram',
            aspectRatio: parsed.contentType === 'Reel' ? '9:16' : 'Variable',
            queryParamsDetected: parsed.queryParamsDetected,
          },
          accessNotice: `Meta oEmbed returned HTTP ${upstream.status}. The post may be private, deleted, or require elevated Meta App permissions. Private accounts and access controls are respected and never bypassed. Upload your authorized source video file to analyze it.`,
          error: errBody ? `Meta API: ${errBody.slice(0, 180)}` : undefined,
        });
        return;
      }

      const data = (await upstream.json()) as {
        title?: string;
        author_name?: string;
        author_url?: string;
        thumbnail_url?: string;
        thumbnail_width?: number;
        thumbnail_height?: number;
        provider_name?: string;
      };

      const hashtags = Array.from(new Set((data.title ?? '').match(/#[A-Za-z0-9_]+/g) ?? [])).slice(0, 12);
      const aspectRatio =
        data.thumbnail_width && data.thumbnail_height
          ? `${data.thumbnail_width}:${data.thumbnail_height}`
          : parsed.contentType === 'Reel'
          ? '9:16'
          : 'Unknown';

      const thumbnailDataUrl = await fetchThumbnailDataUrl(data.thumbnail_url);

      res.json({
        valid: true,
        url: rawUrl,
        normalizedUrl: parsed.normalizedUrl,
        shortcode: parsed.shortcode,
        contentType: parsed.contentType,
        creatorHandle: data.author_name ? `@${data.author_name}` : parsed.creatorHandle,
        oEmbedAvailable: true,
        oEmbedConfigured: true,
        directVideoAvailable: false,
        metadata: {
          title: data.title || `Instagram ${parsed.contentType} (${parsed.shortcode})`,
          caption: data.title,
          hashtags,
          authorName: data.author_name || parsed.creatorHandle || 'Instagram Creator',
          authorUrl: data.author_url,
          thumbnailUrl: data.thumbnail_url,
          thumbnailDataUrl,
          thumbnailWidth: data.thumbnail_width,
          thumbnailHeight: data.thumbnail_height,
          providerName: data.provider_name || 'Instagram',
          aspectRatio,
          publicMetaExtracted: true,
          queryParamsDetected: parsed.queryParamsDetected,
        },
        accessNotice:
          'Authorized Meta oEmbed metadata & cover frame retrieved. Ready to build a complete downloadable Adobe Premiere Pro project with separated clips, caption layers, and sound design layers (or attach your local MP4 for frame-accurate pixel analysis).',
      });
    } catch (err) {
      res.status(502).json({
        valid: true,
        url: rawUrl,
        normalizedUrl: parsed.normalizedUrl,
        shortcode: parsed.shortcode,
        contentType: parsed.contentType,
        oEmbedAvailable: false,
        oEmbedConfigured: true,
        directVideoAvailable: false,
        accessNotice:
          'Unable to reach Meta oEmbed endpoint right now. You can upload your authorized video file directly to analyze it.',
        error: err instanceof Error ? err.message : 'Upstream request failed',
      });
    }
  });

  // Server-side Gemini Multimodal Reverse-Engineering Analysis (Deep Visual FX + Free/Paid Filtering + Deep Audio FX)
  app.post('/api/analyze', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY is not configured on the server. Please verify your API key in Settings > Secrets.',
      });
      return;
    }

    const { metadata, rawShots, keyframes, colorMeasurements, audioMeasurements, sourceContext } =
      req.body ?? {};

    if (!metadata || !Array.isArray(rawShots) || !Array.isArray(keyframes) || keyframes.length === 0) {
      res.status(400).json({
        error: 'Missing required video metadata, shot boundaries, or sampled keyframes.',
      });
      return;
    }

    // Cap frames sent to Gemini (adaptive shot + caption cadence inspection: max 24 keyframe images)
    const boundedKeyframes = keyframes.slice(0, 24) as Array<{
      shotIndex: number;
      timeSec: number;
      role: string;
      base64Jpeg: string;
    }>;

    const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = [];

    for (const kf of boundedKeyframes) {
      const cleanBase64 = kf.base64Jpeg.replace(/^data:image\/\w+;base64,/, '');
      parts.push({
        text: `Frame [Shot #${kf.shotIndex + 1}, timestamp ${kf.timeSec.toFixed(2)}s, role: ${kf.role}]`,
      });
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: cleanBase64,
        },
      });
    }

    const technicalBrief = {
      video: {
        width: metadata.width,
        height: metadata.height,
        aspectRatio: metadata.aspectRatio,
        durationSec: metadata.durationSec,
        fps: metadata.fps,
        container: metadata.container,
        sourceUrl: sourceContext?.normalizedUrl || null,
        instagramContext: sourceContext?.valid
          ? {
              contentType: sourceContext.contentType,
              creatorHandle: sourceContext.creatorHandle,
              title: sourceContext.metadata?.title,
              caption: sourceContext.metadata?.caption,
              hashtags: sourceContext.metadata?.hashtags,
            }
          : null,
      },
      cvDetectedShots: rawShots.map((s: Record<string, unknown>) => ({
        index: s.index,
        startTimeSec: s.startTimeSec,
        endTimeSec: s.endTimeSec,
        durationSec: s.durationSec,
        measuredMotionScore: s.measuredMotionScore,
        measuredCutDelta: s.measuredCutDelta,
        flashSpikeDetected: s.flashSpikeDetected,
        blurDropDetected: s.blurDropDetected,
        chromaSpreadScore: s.chromaSpreadScore,
        beatAligned: s.beatAligned,
        alignedBeatTimeSec: s.alignedBeatTimeSec,
      })),
      pixelColorMeasurements: colorMeasurements,
      webAudioMeasurements: {
        hasAudio: audioMeasurements?.hasAudio,
        estimatedBpm: audioMeasurements?.estimatedBpm,
        beatCount: audioMeasurements?.beats?.length ?? 0,
        downbeatTimes: (audioMeasurements?.beats ?? [])
          .filter((b: { isDownbeat: boolean }) => b.isDownbeat)
          .slice(0, 16)
          .map((b: { timeSec: number }) => Number(b.timeSec.toFixed(2))),
        transientCandidateTimes: audioMeasurements?.transientTimes ?? [],
        hasFadeIn: audioMeasurements?.hasFadeIn ?? false,
        hasFadeOut: audioMeasurements?.hasFadeOut ?? false,
        spectralProfile: audioMeasurements?.spectralProfile ?? null,
      },
    };

    const promptText = `You are a world-class film editor, VFX supervisor, colorist, motion designer, and audio mastering engineer performing deep reverse-engineering for Adobe Premiere Pro.

Examine ALL attached boundary and midpoint keyframes alongside the Instagram link context, per-shot computer-vision measurements, pixel color histograms, and Web Audio DSP spectral/dynamics telemetry below:

${JSON.stringify(technicalBrief, null, 2)}

CRITICAL RESEARCH & EFFECT RULES:
1. Return one detailed shot entry for EVERY shot in cvDetectedShots (exact matching index 0..N-1).
2. WIDE VISUAL EFFECTS RESEARCH & FREE VS PAID CLASSIFICATION:
   - Search widely across every frame and shot transition for visual effects:
     * FREE / BUILT-IN PREMIERE PRO EFFECTS (mark licenseTier = "Free / Built-in"):
       Basic Motion (Zoom In/Out, Pan, Tilt, Rotation), Transform (Shutter Angle Motion Blur), Gaussian Blur, Directional Blur, Fast Box Blur, Sharpen / Unsharp Mask, Lumetri Color (Vignette, Film Fade, Exposure Flash), Dip to White / Dip to Black, Cross Dissolve, Film Dissolve, Slide / Push, Crop (Split-Screen / Cinematic Letterbox), Mirror, Offset, Posterize Time (Stop-Motion Frame Rate), VR Chromatic Aberrations (RGB Split), VR Digital Glitch, Strobe Light, Noise / Film Grain, Lens Distortion, Wave Warp, Tint, Invert, Echo, Time Remapping (Speed Ramp / Slow-Mo / Fast-Mo).
     * PAID / THIRD-PARTY PLUGINS (mark licenseTier = "Paid / Third-Party"):
       If you observe unmistakable proprietary paid plugin looks (such as Boris FX Sapphire S_Shake / S_Glow / S_Flicker, Red Giant Universe VHS / Holomatrix / Heatwave, Dehancer Pro Halation & Gate Weave, FilmConvert Nitrate, Twixtor Pro optical flow warp, RSMB ReelSmart Motion Blur, Deep Glow, Optical Flares, or paid preset packs), classify them honestly as "Paid / Third-Party" with pluginVendor and skippedReason. Our pipeline will automatically skip Paid effects and include ALL Free / Built-in effects cleanly!
   - Identify ALL free/built-in visual effects actually supported by the frames and CV measurements (flashSpikeDetected, blurDropDetected, chromaSpreadScore, measuredMotionScore, vignette, fade, grain, speed changes).
3. DEEP AUDIO ANALYSIS & AUDIO EFFECTS (FREE VS PAID):
   - Analyze the Web Audio spectralProfile (subBassEnergy, bassEnergy, midEnergy, highEnergy, integratedRmsDb, dynamicRangeDb, stereoWidthPercent, reverbTailEstimate, lowPassFilterDetected, sidechainOrDuckingDetected), BPM, fades, and transientCandidateTimes.
   - Return a comprehensive list of audioEffects used in the mix!
     * FREE / BUILT-IN PREMIERE AUDIO EFFECTS (licenseTier = "Free / Built-in"):
       Parametric Equalizer (premiereEffectId: "ParametricEqualizer"), Lowpass ("Lowpass"), Highpass ("Highpass"), Single-band Compressor ("SingleBandCompressor"), Hard Limiter ("HardLimiter"), Studio Reverb ("StudioReverb"), Analog Delay ("AnalogDelay"), DeNoise ("DeNoise"), Pitch Shifter ("PitchShifter"), Stereo Expander ("StereoExpander"), Exponential Fade / Audio Levels Automation ("audiolevels").
     * PAID AUDIO PLUGINS (licenseTier = "Paid / Third-Party"): e.g., FabFilter Pro-Q, Valhalla VintageVerb, Waves L2, Soundtoys EchoBoy, Auto-Tune Pro — mark as "Paid / Third-Party" if clearly characteristic so the pipeline skips them cleanly while keeping all Free audio effects!
4. CAPTIONS & OCR MOTION GRAPHICS (ZERO SPELLING MISTAKES + EXACT STYLE + ANIMATIONS):
   - Carefully inspect EVERY SINGLE attached frame (including caption-cadence frames) for any burned-in captions, subtitles, karaoke word popups, hooks, or on-screen text.
   - SPELLING ACCURACY IS MANDATORY: Read every word character-by-character, double-check spelling, grammar, and punctuation against visual evidence and sentence context so there are ZERO OCR typos or garbled characters! If a caption appears across consecutive frames, merge it into clean, non-overlapping chronological caption cues with accurate startTimeSec and endTimeSec.
   - CAPTURE CAPTION STYLE ACCURATELY:
     * Set isCaption = true and type = "Caption" (or "Subtitle") for spoken/dialogue captions; set isCaption = false for standalone titles/logos.
     * Identify captionStylePreset from: "Bold Hormozi", "Karaoke Highlight", "Boxed Pill", "Neon Glow", "Outline Impact", "Minimal Clean", "Typewriter Mono".
     * Measure exact visual styling: fontFamily (e.g. "Montserrat", "Outfit", "Anton", "Inter", "JetBrains Mono"), fontSize, fontWeight (400–900), colorHex (main text color), outlineColorHex & outlineWidthPx (stroke thickness 0–10), backgroundColorHex & backgroundOpacity (0 if no box, 65–95 if boxed pill/bar), highlightColorHex & highlightWord (if one word is highlighted in yellow/green/purple/red), textTransform ("uppercase" | "capitalize" | "none"), hasShadow (true/false), and exact positionXPercent & positionYPercent.
   - CAPTURE CAPTION ANIMATION ACCURATELY:
     * Choose animationType from: "Bounce Pop", "Word Highlight", "Karaoke Sweep", "Pop In", "Slide Up", "Kinetic Scale", "Typewriter", "Glow Pulse", "Fade", "None" based on how words appear/highlight across consecutive frames.
   - ONLY report captions/text ACTUALLY VISIBLE in the attached frames. If there are genuinely no captions or text on screen, return []. NEVER fabricate text.
5. Never falsely identify a copyrighted song name or artist. Describe audio objectively.`;

    parts.push({ text: promptText });

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        summary: {
          type: Type.OBJECT,
          properties: {
            styleLabel: { type: Type.STRING },
            pacingLabel: { type: Type.STRING },
            rhythmPattern: { type: Type.STRING },
            openingSequenceNote: { type: Type.STRING },
            mainSequenceNote: { type: Type.STRING },
            closingSequenceNote: { type: Type.STRING },
            technicalOverview: { type: Type.STRING },
          },
          required: [
            'styleLabel',
            'pacingLabel',
            'rhythmPattern',
            'openingSequenceNote',
            'mainSequenceNote',
            'closingSequenceNote',
            'technicalOverview',
          ],
        },
        shots: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              index: { type: Type.INTEGER },
              name: { type: Type.STRING },
              shotType: { type: Type.STRING },
              section: { type: Type.STRING },
              subjectPosition: { type: Type.STRING },
              cameraMovement: { type: Type.STRING },
              speedPercent: { type: Type.NUMBER },
              speedRampProfile: { type: Type.STRING },
              estimatedScale: { type: Type.NUMBER },
              estimatedEndScale: { type: Type.NUMBER },
              estimatedPositionX: { type: Type.NUMBER },
              estimatedPositionY: { type: Type.NUMBER },
              estimatedRotation: { type: Type.NUMBER },
              transitionType: { type: Type.STRING },
              transitionDurationSec: { type: Type.NUMBER },
              transitionIntensity: { type: Type.NUMBER },
              transitionDirection: { type: Type.STRING },
              transitionPremiereSupport: { type: Type.STRING },
              transitionPremiereMapping: { type: Type.STRING },
              colorShiftNote: { type: Type.STRING },
              confidence: { type: Type.STRING },
              description: { type: Type.STRING },
            },
            required: [
              'index',
              'name',
              'shotType',
              'section',
              'subjectPosition',
              'cameraMovement',
              'speedPercent',
              'speedRampProfile',
              'estimatedScale',
              'estimatedEndScale',
              'transitionType',
              'transitionDurationSec',
              'transitionIntensity',
              'transitionDirection',
              'transitionPremiereSupport',
              'transitionPremiereMapping',
              'colorShiftNote',
              'confidence',
              'description',
            ],
          },
        },
        effects: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              category: { type: Type.STRING },
              shotIndex: { type: Type.INTEGER },
              startTimeSec: { type: Type.NUMBER },
              endTimeSec: { type: Type.NUMBER },
              intensity: { type: Type.NUMBER },
              direction: { type: Type.STRING },
              confidence: { type: Type.STRING },
              licenseTier: { type: Type.STRING },
              pluginVendor: { type: Type.STRING },
              skippedReason: { type: Type.STRING },
              premiereSupport: { type: Type.STRING },
              premiereEffectName: { type: Type.STRING },
              premiereEffectId: { type: Type.STRING },
              approximationNote: { type: Type.STRING },
            },
            required: [
              'name',
              'category',
              'startTimeSec',
              'endTimeSec',
              'intensity',
              'direction',
              'confidence',
              'licenseTier',
              'premiereSupport',
              'premiereEffectName',
              'approximationNote',
            ],
          },
        },
        motionGraphics: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              type: { type: Type.STRING },
              isCaption: { type: Type.BOOLEAN },
              startTimeSec: { type: Type.NUMBER },
              endTimeSec: { type: Type.NUMBER },
              fontFamily: { type: Type.STRING },
              fontSize: { type: Type.INTEGER },
              fontWeight: { type: Type.INTEGER },
              positionXPercent: { type: Type.NUMBER },
              positionYPercent: { type: Type.NUMBER },
              colorHex: { type: Type.STRING },
              outlineColorHex: { type: Type.STRING },
              outlineWidthPx: { type: Type.NUMBER },
              backgroundColorHex: { type: Type.STRING },
              backgroundOpacity: { type: Type.INTEGER },
              highlightColorHex: { type: Type.STRING },
              highlightWord: { type: Type.STRING },
              textTransform: { type: Type.STRING },
              captionStylePreset: { type: Type.STRING },
              hasShadow: { type: Type.BOOLEAN },
              animationType: { type: Type.STRING },
              animationDurationSec: { type: Type.NUMBER },
              confidence: { type: Type.STRING },
              fontSubstituteNote: { type: Type.STRING },
            },
            required: [
              'text',
              'type',
              'isCaption',
              'startTimeSec',
              'endTimeSec',
              'fontFamily',
              'fontSize',
              'positionXPercent',
              'positionYPercent',
              'colorHex',
              'animationType',
              'confidence',
            ],
          },
        },
        audioDesign: {
          type: Type.OBJECT,
          properties: {
            musicDescription: { type: Type.STRING },
            voiceoverDetected: { type: Type.BOOLEAN },
            voiceoverNotes: { type: Type.STRING },
            sfxEvents: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  category: { type: Type.STRING },
                  timeSec: { type: Type.NUMBER },
                  durationSec: { type: Type.NUMBER },
                  linkedVisualEvent: { type: Type.STRING },
                  confidence: { type: Type.STRING },
                },
                required: ['label', 'category', 'timeSec', 'durationSec', 'linkedVisualEvent', 'confidence'],
              },
            },
            audioEffects: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  category: { type: Type.STRING },
                  trackId: { type: Type.STRING },
                  startTimeSec: { type: Type.NUMBER },
                  endTimeSec: { type: Type.NUMBER },
                  intensity: { type: Type.NUMBER },
                  licenseTier: { type: Type.STRING },
                  pluginVendor: { type: Type.STRING },
                  skippedReason: { type: Type.STRING },
                  premiereEffectName: { type: Type.STRING },
                  premiereEffectId: { type: Type.STRING },
                  confidence: { type: Type.STRING },
                  notes: { type: Type.STRING },
                },
                required: [
                  'name',
                  'category',
                  'trackId',
                  'startTimeSec',
                  'endTimeSec',
                  'intensity',
                  'licenseTier',
                  'premiereEffectName',
                  'premiereEffectId',
                  'confidence',
                  'notes',
                ],
              },
            },
          },
          required: ['musicDescription', 'voiceoverDetected', 'voiceoverNotes', 'sfxEvents', 'audioEffects'],
        },
        colorProfile: {
          type: Type.OBJECT,
          properties: {
            profileName: { type: Type.STRING },
            skinToneNote: { type: Type.STRING },
            confidence: { type: Type.STRING },
            confidenceScore: { type: Type.INTEGER },
          },
          required: ['profileName', 'skinToneNote', 'confidence', 'confidenceScore'],
        },
        compatibility: {
          type: Type.OBJECT,
          properties: {
            fullyReconstructed: { type: Type.ARRAY, items: { type: Type.STRING } },
            approximate: { type: Type.ARRAY, items: { type: Type.STRING } },
            unsupported: { type: Type.ARRAY, items: { type: Type.STRING } },
            missingAssets: { type: Type.ARRAY, items: { type: Type.STRING } },
            manualAdjustments: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: [
            'fullyReconstructed',
            'approximate',
            'unsupported',
            'missingAssets',
            'manualAdjustments',
          ],
        },
      },
      required: ['summary', 'shots', 'effects', 'motionGraphics', 'audioDesign', 'colorProfile', 'compatibility'],
    };

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          systemInstruction:
            'You are Reel2Premiere AI, a thorough video, caption OCR, and audio reverse-engineering specialist. Research visual and audio effects widely. Strictly label Free/Built-in Adobe Premiere Pro effects as "Free / Built-in" and proprietary paid third-party plugins as "Paid / Third-Party". For visible captions and subtitles, verify every single word carefully for 100% accurate spelling (zero typos), exact visual style (colors, outline, background box, highlight word, casing), and caption animations. Never invent text not visible in the frames.',
          responseMimeType: 'application/json',
          responseSchema,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Gemini returned an empty analysis response.' });
        return;
      }

      const parsed = JSON.parse(rawText);
      res.json({ ok: true, analysis: parsed });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gemini analysis request failed.';
      console.error('[Reel2Premiere AI] Gemini error:', msg);
      const status = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')
        ? 429
        : msg.includes('403') || msg.includes('PERMISSION_DENIED')
        ? 403
        : 500;
      res.status(status).json({
        error: `AI analysis error: ${msg}`,
      });
    }
  });

  // Safe server proxy for publicly exposed direct video streams (SSRF-protected, video/* only, 80MB max)
  app.get('/api/media/proxy-video', async (req, res) => {
    const target = String(req.query?.url ?? '').trim();
    if (!target || !isSafePublicHttpUrl(target)) {
      res.status(400).json({ error: 'Invalid or disallowed public video URL.' });
      return;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const upstream = await fetch(target, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Reel2PremiereAI-MediaProxy/1.0' },
        redirect: 'follow',
      });
      clearTimeout(timer);

      if (!upstream.ok) {
        res.status(502).json({ error: `Upstream video host returned HTTP ${upstream.status}` });
        return;
      }
      const ctype = (upstream.headers.get('content-type') || '').toLowerCase();
      if (!ctype.startsWith('video/') && !ctype.includes('octet-stream')) {
        res.status(415).json({ error: 'URL did not return a playable video stream.' });
        return;
      }
      const clen = Number(upstream.headers.get('content-length') || 0);
      if (clen > 80 * 1024 * 1024) {
        res.status(413).json({ error: 'Remote video exceeds 80 MB browser proxy limit.' });
        return;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      if (buf.length > 80 * 1024 * 1024) {
        res.status(413).json({ error: 'Remote video exceeds 80 MB browser proxy limit.' });
        return;
      }
      res.setHeader('Content-Type', ctype.startsWith('video/') ? ctype : 'video/mp4');
      res.setHeader('Content-Length', String(buf.length));
      res.send(buf);
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Unable to fetch public video stream.',
      });
    }
  });

  // Deep Link-Based AI Reconstruction (reconstructs separated clips, caption layers, sound design layers & LUT directly from a pasted Reel/video URL)
  app.post('/api/analyze-link', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured on the server.',
      });
      return;
    }

    const { instagramInfo } = req.body ?? {};
    if (!instagramInfo || !instagramInfo.valid) {
      res.status(400).json({ error: 'Provide a validated URL inspection result.' });
      return;
    }

    const estDuration = Math.max(
      8,
      Math.min(60, Number(instagramInfo?.metadata?.estimatedDurationSec) || 15)
    );

    const parts: Array<
      { text: string } | { inlineData: { mimeType: string; data: string } }
    > = [
      {
        text: `You are Reel2Premiere AI — a senior short-form Reel editor, colorist, motion graphics artist, and sound designer.
Analyze the following pasted Instagram Reel / Video link and its extracted public metadata (plus cover poster frame if attached) to build a COMPLETE, PRODUCTION-READY Adobe Premiere Pro multitrack reconstruction blueprint:

URL & METADATA:
${JSON.stringify(
  {
    normalizedUrl: instagramInfo.normalizedUrl,
    shortcode: instagramInfo.shortcode,
    contentType: instagramInfo.contentType,
    creatorHandle: instagramInfo.creatorHandle,
    title: instagramInfo.metadata?.title,
    caption: instagramInfo.metadata?.caption,
    hashtags: instagramInfo.metadata?.hashtags,
    aspectRatio: instagramInfo.metadata?.aspectRatio || '9:16',
    estimatedDurationSec: estDuration,
  },
  null,
  2
)}

MANDATORY DELIVERABLES FOR THIS PREMIERE PRO PROJECT:
1. SEPARATED VIDEO CLIPS (Track V1): Break the full ${estDuration}s Reel into 6 to 9 distinct, chronological, non-overlapping shot clips covering 0.0s to ${estDuration}s seamlessly (no gaps). Give each clip a specific descriptive name (e.g. "Hook Intro Close-Up", "Dynamic Reveal Cut", "B-Roll Accent", "Climax Beat Drop", "Closing CTA"), shotType, section (Opening/Main/Closing), cameraMovement, speedPercent, speedRampProfile, estimatedScale, estimatedEndScale, outgoing transitionType & duration, and premiereMapping.
2. FREE / BUILT-IN VIDEO EFFECTS ONLY (Track V2): Include practical Free / Built-in Adobe Premiere Pro effects (Gaussian Blur, Directional Blur, VR Glow, Lumetri Color, VR Chromatic Aberrations, Transform, Lens Distortion, Noise, Dip to White). If a trending Reel style typically uses a paid plugin (e.g. Sapphire Shake, RSMB, Twixtor), flag it with licenseTier="Paid / Third-Party" so it is cleanly skipped while Free effects stay included!
3. ACCURATE STYLED & ANIMATED CAPTION LAYERS (Track V3/V4 + .srt):
   - Extract or craft crisp, short-form Reel caption cues timed across the video based on the visible cover text, post caption, topic, and hashtags.
   - ZERO SPELLING MISTAKES: double-check every single word for 100% accurate spelling (preserve English / Roman Urdu / original language naturally).
   - Provide full caption styling: captionStylePreset ("Bold Hormozi" | "Karaoke Highlight" | "Boxed Pill" | "Neon Glow" | "Outline Impact" | "Minimal Clean" | "Typewriter Mono"), fontFamily, fontSize, fontWeight, colorHex, outlineColorHex, outlineWidthPx, backgroundColorHex, backgroundOpacity, highlightColorHex, highlightWord (exact word from text), textTransform, and animationType ("Bounce Pop" | "Word Highlight" | "Karaoke Sweep" | "Pop In" | "Slide Up" | "Kinetic Scale" | "Typewriter" | "Glow Pulse" | "Fade").
4. MULTI-LAYER SOUND DESIGN (Track A2 Music + Track A3/A4 SFX + Track A5 Voiceover):
   - Provide estimatedBpm (e.g. 118–132 BPM), musicDescription, and 3–4 musical sections (Intro, Build-Up, Beat Drop / Hook, Outro) covering 0 to ${estDuration}s for Track A2.
   - Provide 6 to 10 timed Sound Design SFX events (Whoosh, Impact, Riser, Drop, Bass Hit, Click, Swish, Transition SFX, Ambient) aligned precisely to shot cut boundaries and caption pops for Track A3/A4!
   - Set voiceoverDetected & voiceoverNotes for Track A5.
   - Include Free / Built-in Premiere Pro audio effects (Parametric Equalizer, Dynamics, Multiband Compressor, Studio Reverb, DeNoise, Hard Limiter, Highpass, Lowpass) for Track A1/A2/A5.
5. COLOR GRADING (.cube LUT): If the cover poster image is attached, measure its visual color palette, contrast, temperature, saturation, and lighting accurately; otherwise provide a crisp look matching the Reel niche.`,
      },
    ];

    const thumbData: string | undefined = instagramInfo?.metadata?.thumbnailDataUrl;
    if (typeof thumbData === 'string' && thumbData.startsWith('data:image/')) {
      const commaIdx = thumbData.indexOf(',');
      const header = thumbData.slice(5, commaIdx);
      const mimeType = header.split(';')[0] || 'image/jpeg';
      const b64 = thumbData.slice(commaIdx + 1);
      if (b64.length > 50) {
        parts.push({ text: 'Attached Cover / Poster Frame from the pasted Reel URL:' });
        parts.push({ inlineData: { mimeType, data: b64 } });
      }
    }

    const linkSchema = {
      type: Type.OBJECT,
      properties: {
        durationSec: { type: Type.NUMBER },
        summary: {
          type: Type.OBJECT,
          properties: {
            styleLabel: { type: Type.STRING },
            pacingLabel: { type: Type.STRING },
            openingHookNote: { type: Type.STRING },
            editingRhythmSummary: { type: Type.STRING },
          },
          required: ['styleLabel', 'pacingLabel', 'openingHookNote', 'editingRhythmSummary'],
        },
        shots: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              index: { type: Type.INTEGER },
              name: { type: Type.STRING },
              startTimeSec: { type: Type.NUMBER },
              endTimeSec: { type: Type.NUMBER },
              shotType: { type: Type.STRING },
              section: { type: Type.STRING },
              cameraMovement: { type: Type.STRING },
              subjectPosition: { type: Type.STRING },
              speedPercent: { type: Type.NUMBER },
              speedRampProfile: { type: Type.STRING },
              estimatedScale: { type: Type.NUMBER },
              estimatedEndScale: { type: Type.NUMBER },
              transitionType: { type: Type.STRING },
              transitionDurationSec: { type: Type.NUMBER },
              transitionDirection: { type: Type.STRING },
              premiereMapping: { type: Type.STRING },
              notes: { type: Type.STRING },
              confidence: { type: Type.STRING },
            },
            required: ['index', 'name', 'startTimeSec', 'endTimeSec', 'shotType', 'cameraMovement', 'transitionType'],
          },
        },
        effects: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              category: { type: Type.STRING },
              startTimeSec: { type: Type.NUMBER },
              endTimeSec: { type: Type.NUMBER },
              intensity: { type: Type.NUMBER },
              premiereEffectName: { type: Type.STRING },
              premiereEffectId: { type: Type.STRING },
              licenseTier: { type: Type.STRING },
              pluginVendor: { type: Type.STRING },
              skippedReason: { type: Type.STRING },
              approximationNote: { type: Type.STRING },
              confidence: { type: Type.STRING },
            },
            required: ['name', 'category', 'startTimeSec', 'endTimeSec', 'intensity', 'premiereEffectName', 'licenseTier'],
          },
        },
        motionGraphics: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              text: { type: Type.STRING },
              type: { type: Type.STRING },
              isCaption: { type: Type.BOOLEAN },
              startTimeSec: { type: Type.NUMBER },
              endTimeSec: { type: Type.NUMBER },
              fontFamily: { type: Type.STRING },
              fontSize: { type: Type.NUMBER },
              fontWeight: { type: Type.NUMBER },
              positionXPercent: { type: Type.NUMBER },
              positionYPercent: { type: Type.NUMBER },
              colorHex: { type: Type.STRING },
              outlineColorHex: { type: Type.STRING },
              outlineWidthPx: { type: Type.NUMBER },
              backgroundColorHex: { type: Type.STRING },
              backgroundOpacity: { type: Type.NUMBER },
              highlightColorHex: { type: Type.STRING },
              highlightWord: { type: Type.STRING },
              textTransform: { type: Type.STRING },
              captionStylePreset: { type: Type.STRING },
              hasShadow: { type: Type.BOOLEAN },
              animationType: { type: Type.STRING },
              animationDurationSec: { type: Type.NUMBER },
              confidence: { type: Type.STRING },
            },
            required: ['text', 'type', 'startTimeSec', 'endTimeSec', 'animationType'],
          },
        },
        colorProfile: {
          type: Type.OBJECT,
          properties: {
            profileName: { type: Type.STRING },
            exposure: { type: Type.NUMBER },
            contrast: { type: Type.NUMBER },
            temperature: { type: Type.NUMBER },
            tint: { type: Type.NUMBER },
            saturation: { type: Type.NUMBER },
            highlights: { type: Type.NUMBER },
            shadows: { type: Type.NUMBER },
            vignette: { type: Type.NUMBER },
            fade: { type: Type.NUMBER },
            filmGrain: { type: Type.NUMBER },
            skinToneNote: { type: Type.STRING },
          },
          required: ['profileName', 'contrast', 'temperature', 'saturation'],
        },
        audioDesign: {
          type: Type.OBJECT,
          properties: {
            estimatedBpm: { type: Type.NUMBER },
            musicDescription: { type: Type.STRING },
            voiceoverDetected: { type: Type.BOOLEAN },
            voiceoverNotes: { type: Type.STRING },
            sections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  startTimeSec: { type: Type.NUMBER },
                  endTimeSec: { type: Type.NUMBER },
                  energyLevel: { type: Type.NUMBER },
                  description: { type: Type.STRING },
                },
                required: ['name', 'startTimeSec', 'endTimeSec', 'energyLevel'],
              },
            },
            sfxEvents: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  label: { type: Type.STRING },
                  category: { type: Type.STRING },
                  timeSec: { type: Type.NUMBER },
                  durationSec: { type: Type.NUMBER },
                  linkedVisualEvent: { type: Type.STRING },
                  confidence: { type: Type.STRING },
                },
                required: ['label', 'category', 'timeSec', 'durationSec'],
              },
            },
            audioEffects: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  category: { type: Type.STRING },
                  trackId: { type: Type.STRING },
                  startTimeSec: { type: Type.NUMBER },
                  endTimeSec: { type: Type.NUMBER },
                  intensity: { type: Type.NUMBER },
                  premiereEffectName: { type: Type.STRING },
                  premiereEffectId: { type: Type.STRING },
                  licenseTier: { type: Type.STRING },
                  pluginVendor: { type: Type.STRING },
                  notes: { type: Type.STRING },
                },
                required: ['name', 'category', 'premiereEffectName', 'licenseTier'],
              },
            },
          },
          required: ['estimatedBpm', 'musicDescription', 'voiceoverDetected', 'sections', 'sfxEvents'],
        },
      },
      required: ['summary', 'shots', 'effects', 'motionGraphics', 'colorProfile', 'audioDesign'],
    };

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          systemInstruction:
            'You are Reel2Premiere AI. Reconstruct pasted Instagram Reels and short-form video links into editable, multi-layered Adobe Premiere Pro timelines with separated shot clips (V1), Free/Built-in video effects (V2), zero-spelling-mistake styled & animated caption layers (V3/V4), and separate music/SFX/voiceover sound design layers (A2/A3/A4/A5).',
          responseMimeType: 'application/json',
          responseSchema: linkSchema,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Gemini returned an empty link reconstruction response.' });
        return;
      }

      const parsed = JSON.parse(rawText);
      res.json({ ok: true, analysis: parsed });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Link reconstruction failed.';
      console.error('[Reel2Premiere AI] Link analysis error:', msg);
      res.status(500).json({ error: msg });
    }
  });

  // Dedicated zero-typo caption spellcheck & proofreading pass (preserves timing & style)
  app.post('/api/captions/proofread', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured on the server.',
      });
      return;
    }

    const { captions, context, contextNote } = req.body ?? {};
    if (!Array.isArray(captions) || captions.length === 0) {
      res.status(400).json({ error: 'Provide a non-empty captions array to proofread.' });
      return;
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Proofread the following video captions extracted via OCR and fix ANY spelling mistakes, OCR letter confusions (e.g. l/I, 0/O, rn/m), duplicated spaces, or broken punctuation while strictly preserving the original language (English, Urdu/Roman Urdu, Hindi, etc.), tone, meaning, and exact item IDs. Set fixedSpelling to true if you changed any characters. Also ensure highlightWord (if provided) matches an exact word in the corrected text.\n\nContext: ${JSON.stringify(context ?? contextNote ?? '')}\n\nCaptions:\n${JSON.stringify(captions, null, 2)}`,
        config: {
          systemInstruction:
            'You are a meticulous broadcast subtitle proofreader. Fix every spelling mistake with 100% accuracy while keeping the exact meaning, concise short-form pacing, and original language.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              captions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    text: { type: Type.STRING },
                    highlightWord: { type: Type.STRING },
                    fixedSpelling: { type: Type.BOOLEAN },
                    correctionNote: { type: Type.STRING },
                  },
                  required: ['id', 'text'],
                },
              },
            },
            required: ['captions'],
          },
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      const rawText = (response.text ?? '').trim();
      const parsed = JSON.parse(rawText || '{"captions":[]}');
      const list = Array.isArray(parsed.captions) ? parsed.captions : [];
      res.json({ ok: true, captions: list, corrected: list });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Caption proofreading failed.';
      res.status(500).json({ error: msg });
    }
  });

  // Project history persistence endpoints
  app.get('/api/projects', (_req, res) => {
    const projects = readStoredProjects();
    res.json({ projects });
  });

  app.post('/api/projects', (req, res) => {
    const project = req.body?.project;
    if (!project || !project.id) {
      res.status(400).json({ error: 'Invalid project payload.' });
      return;
    }
    const existing = readStoredProjects() as Array<{ id: string }>;
    const filtered = existing.filter((p) => p.id !== project.id);
    const updated = [project, ...filtered].slice(0, 30);
    writeStoredProjects(updated);
    res.json({ ok: true, count: updated.length });
  });

  app.delete('/api/projects/:id', (req, res) => {
    const { id } = req.params;
    const existing = readStoredProjects() as Array<{ id: string }>;
    const updated = existing.filter((p) => p.id !== id);
    writeStoredProjects(updated);
    res.json({ ok: true, count: updated.length });
  });

  // Vite dev middleware or production static files
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Reel2Premiere AI server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
