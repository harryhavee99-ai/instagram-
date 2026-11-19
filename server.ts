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

  return {
    valid: true,
    normalizedUrl,
    shortcode,
    contentType,
    creatorHandle,
  };
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

  // Authorized Instagram URL validation + official Meta oEmbed metadata lookup
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
      res.json({
        valid: true,
        url: rawUrl,
        normalizedUrl: parsed.normalizedUrl,
        shortcode: parsed.shortcode,
        contentType: parsed.contentType,
        creatorHandle: parsed.creatorHandle,
        oEmbedAvailable: false,
        oEmbedConfigured: false,
        directVideoAvailable: false,
        metadata: {
          title: `Instagram ${parsed.contentType} (${parsed.shortcode})`,
          authorName: parsed.creatorHandle ?? 'Creator metadata requires Meta oEmbed token',
          providerName: 'Instagram',
          aspectRatio: parsed.contentType === 'Reel' ? '9:16 (Standard Reel)' : 'Variable',
        },
        accessNotice:
          'Instagram URL validated. Official Meta oEmbed lookup requires META_OEMBED_TOKEN on the server, and Meta oEmbed never exposes raw downloadable video streams. Upload your authorized video file below to run full frame-by-frame reverse engineering.',
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
          authorName: data.author_name || parsed.creatorHandle || 'Instagram Creator',
          authorUrl: data.author_url,
          thumbnailUrl: data.thumbnail_url,
          thumbnailWidth: data.thumbnail_width,
          thumbnailHeight: data.thumbnail_height,
          providerName: data.provider_name || 'Instagram',
          aspectRatio,
        },
        accessNotice:
          'Authorized Meta oEmbed metadata retrieved. Per Meta platform policy, oEmbed returns preview metadata only and does not provide the raw video file. Attach your authorized original video file below to run full frame-by-frame reverse engineering.',
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

  // Server-side Gemini Multimodal Reverse-Engineering Analysis
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

    // Cap frames sent to Gemini (adaptive inspection: max 14 keyframe images)
    const boundedKeyframes = keyframes.slice(0, 14) as Array<{
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
      },
      cvDetectedShots: rawShots.map((s: Record<string, unknown>) => ({
        index: s.index,
        startTimeSec: s.startTimeSec,
        endTimeSec: s.endTimeSec,
        durationSec: s.durationSec,
        measuredMotionScore: s.measuredMotionScore,
        measuredCutDelta: s.measuredCutDelta,
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
      },
    };

    const promptText = `You are a senior film editor, colorist, motion designer, and sound designer performing technical video reverse-engineering for Adobe Premiere Pro reconstruction.

Examine the attached adaptively sampled keyframes (each labeled with its exact shot number and timestamp) alongside the real computer-vision and Web Audio DSP measurements below:

${JSON.stringify(technicalBrief, null, 2)}

CRITICAL RULES FOR HONEST TECHNICAL RECONSTRUCTION:
1. Return one shot analysis entry for EVERY shot in cvDetectedShots (exact matching index 0..N-1).
2. Base your visual descriptions, framing, camera movement, transitions, lighting, and color profile strictly on what is actually visible in the provided keyframes and measured CV motion/histogram deltas.
3. For motionGraphics (OCR text & graphics): ONLY report text, captions, titles, logos, or graphic shapes that are ACTUALLY VISIBLE in the attached keyframes. If NO text is visible in the video, return an empty array [] for motionGraphics. NEVER invent or hallucinate text overlays!
4. Never falsely identify a copyrighted song title or artist from waveform/BPM alone. Describe musical feel/energy objectively (e.g., "Rhythmic 124 BPM electronic pulse") and clearly note if audio separation is estimated.
5. Be honest about Adobe Premiere Pro native compatibility: mark hard cuts, cross dissolves, opacity fades, motion scale/position/rotation, Gaussian blur, and basic Lumetri adjustments as "Native"; mark whip pans, directional blur zoom transitions, light leaks, or glitch RGB splits as "Approximate" or "Unsupported" with clear Premiere alternatives.
6. Provide realistic confidence levels ("High", "Medium", "Low") based on visual clarity and measurement agreement.`;

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
              premiereSupport: { type: Type.STRING },
              premiereEffectName: { type: Type.STRING },
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
              startTimeSec: { type: Type.NUMBER },
              endTimeSec: { type: Type.NUMBER },
              fontFamily: { type: Type.STRING },
              fontSize: { type: Type.INTEGER },
              positionXPercent: { type: Type.NUMBER },
              positionYPercent: { type: Type.NUMBER },
              colorHex: { type: Type.STRING },
              outlineColorHex: { type: Type.STRING },
              hasShadow: { type: Type.BOOLEAN },
              animationType: { type: Type.STRING },
              animationDurationSec: { type: Type.NUMBER },
              confidence: { type: Type.STRING },
              fontSubstituteNote: { type: Type.STRING },
            },
            required: [
              'text',
              'type',
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
          },
          required: ['musicDescription', 'voiceoverDetected', 'voiceoverNotes', 'sfxEvents'],
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
            'You are Reel2Premiere AI, a precise video editing reverse-engineering engine. Return strictly grounded JSON matching the schema. Never invent text overlays that do not appear in the frames.',
          responseMimeType: 'application/json',
          responseSchema,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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
