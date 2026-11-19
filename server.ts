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

function parseInstagramUrl(rawUrl: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, error: 'Please enter an Instagram Reel or video post URL.' };
  }
  let parsed: URL;
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    parsed = new URL(withProto);
  } catch {
    return { valid: false, error: 'Malformed URL. Paste a valid https://www.instagram.com/reel/... link.' };
  }

  const host = parsed.hostname.toLowerCase().replace(/^m\./, '');
  if (host !== 'instagram.com' && host !== 'www.instagram.com' && host !== 'instagr.am') {
    return {
      valid: false,
      error: `Domain "${parsed.hostname}" is not an Instagram URL. Supported formats: instagram.com/reel/<id>, instagram.com/p/<id>, or instagram.com/tv/<id>.`,
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

async function fetchPublicOpenGraphMetadata(normalizedUrl: string): Promise<{
  title?: string;
  caption?: string;
  hashtags?: string[];
  thumbnailUrl?: string;
  authorName?: string;
  publicMetaExtracted: boolean;
}> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html',
        'User-Agent': 'Reel2PremiereAI-MetadataInspector/1.0',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) return { publicMetaExtracted: false };

    const html = (await res.text()).slice(0, 65000);
    const extractMeta = (prop: string) => {
      const m =
        html.match(new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i')) ||
        html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i')) ||
        html.match(new RegExp(`<meta[^>]+name=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'));
      return m ? decodeHtmlEntities(m[1]).trim() : undefined;
    };

    const ogTitle = extractMeta('og:title');
    const ogDesc = extractMeta('og:description') || extractMeta('description');
    const ogImage = extractMeta('og:image');

    // Avoid treating generic login wall pages as post metadata
    const combined = `${ogTitle ?? ''} ${ogDesc ?? ''}`.toLowerCase();
    if (!ogTitle && !ogDesc) return { publicMetaExtracted: false };
    if (combined.includes('login') && combined.includes('instagram') && !ogImage) {
      return { publicMetaExtracted: false };
    }

    const hashtags = Array.from(new Set((ogDesc ?? '').match(/#[A-Za-z0-9_]+/g) ?? [])).slice(0, 12);
    const creatorMatch = (ogTitle ?? '').match(/^([^on(]+?)\s+on\s+Instagram/i);
    const authorName = creatorMatch ? creatorMatch[1].trim() : undefined;

    return {
      title: ogTitle,
      caption: ogDesc,
      hashtags,
      thumbnailUrl: ogImage,
      authorName,
      publicMetaExtracted: Boolean(ogTitle || ogDesc || ogImage),
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

    const token = process.env.META_OEMBED_TOKEN;
    if (!token) {
      // Attempt safe, non-authenticated public OpenGraph tag inspection (never bypasses private accounts or DRM)
      const publicOg = await fetchPublicOpenGraphMetadata(parsed.normalizedUrl!);

      res.json({
        valid: true,
        url: rawUrl,
        normalizedUrl: parsed.normalizedUrl,
        shortcode: parsed.shortcode,
        contentType: parsed.contentType,
        creatorHandle: parsed.creatorHandle || (publicOg.authorName ? `@${publicOg.authorName.replace(/^@/, '')}` : undefined),
        oEmbedAvailable: false,
        oEmbedConfigured: false,
        directVideoAvailable: false,
        metadata: {
          title: publicOg.title || `Instagram ${parsed.contentType} (${parsed.shortcode})`,
          caption: publicOg.caption,
          hashtags: publicOg.hashtags,
          authorName: publicOg.authorName || parsed.creatorHandle || 'Creator metadata requires Meta oEmbed token',
          thumbnailUrl: publicOg.thumbnailUrl,
          providerName: 'Instagram',
          aspectRatio: parsed.contentType === 'Reel' ? '9:16 (Standard Reel)' : 'Variable',
          publicMetaExtracted: publicOg.publicMetaExtracted,
          queryParamsDetected: parsed.queryParamsDetected,
        },
        accessNotice: publicOg.publicMetaExtracted
          ? 'Instagram URL validated and public OpenGraph metadata extracted. Meta oEmbed never exposes raw downloadable video files—attach your authorized video file below to run full frame-by-frame, audio DSP, and free-effect Premiere Pro reconstruction.'
          : 'Instagram URL validated. Official Meta oEmbed lookup requires META_OEMBED_TOKEN on the server, and Meta oEmbed never exposes raw downloadable video streams. Upload your authorized video file below to run full reverse engineering.',
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
          thumbnailWidth: data.thumbnail_width,
          thumbnailHeight: data.thumbnail_height,
          providerName: data.provider_name || 'Instagram',
          aspectRatio,
          publicMetaExtracted: true,
          queryParamsDetected: parsed.queryParamsDetected,
        },
        accessNotice:
          'Authorized Meta oEmbed metadata retrieved. Per Meta platform policy, oEmbed returns preview metadata only and does not provide the raw video file. Attach your authorized original video file below to run full frame-by-frame and audio reverse engineering.',
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

  // Dedicated zero-typo caption spellcheck & proofreading pass (preserves timing & style)
  app.post('/api/captions/proofread', async (req, res) => {
    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured on the server.',
      });
      return;
    }

    const { captions, context } = req.body ?? {};
    if (!Array.isArray(captions) || captions.length === 0) {
      res.status(400).json({ error: 'Provide a non-empty captions array to proofread.' });
      return;
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Proofread the following video captions extracted via OCR and fix ANY spelling mistakes, OCR letter confusions (e.g. l/I, 0/O, rn/m), duplicated spaces, or broken punctuation while strictly preserving the original language (English, Urdu/Roman Urdu, Hindi, etc.), tone, meaning, and exact item IDs. Also ensure highlightWord (if provided) matches an exact word in the corrected text.\n\nContext: ${JSON.stringify(context ?? {})}\n\nCaptions:\n${JSON.stringify(captions, null, 2)}`,
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
      res.json({ ok: true, captions: parsed.captions ?? [] });
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
