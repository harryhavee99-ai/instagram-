/**
 * Synthesizes a real, playable 9:16 vertical short-form Reel video (.webm)
 * directly in the browser using Canvas2D + Web Audio API + MediaRecorder.
 * Features 5 visually distinct shots, camera zooms, flash transition,
 * high-contrast typography overlays, and a synchronized 120 BPM electronic beat.
 */
export async function generateLocalSampleReel(
  onProgress?: (pct: number) => void
): Promise<File> {
  const width = 540;
  const height = 960;
  const fps = 30;
  const durationSec = 8.0; // 4 bars @ 120 BPM = 16 beats

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas2D context unavailable.');

  // Synthesize real 120 BPM audio track via Web Audio API MediaStreamDestination
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const audioCtx = new AudioCtx();
  const dest = audioCtx.createMediaStreamDestination();
  const masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.7;
  masterGain.connect(dest);

  const now = audioCtx.currentTime + 0.05;
  const beatDur = 0.5; // 120 BPM

  for (let b = 0; b < 16; b++) {
    const t = now + b * beatDur;
    // Kick drum on every beat
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.14);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.2);

    // Synth chord stab on downbeats (0, 4, 8, 12)
    if (b % 4 === 0) {
      const notes = b === 8 ? [220, 277.18, 329.63] : [196, 246.94, 293.66];
      for (const freq of notes) {
        const sOsc = audioCtx.createOscillator();
        const sGain = audioCtx.createGain();
        sOsc.type = 'triangle';
        sOsc.frequency.setValueAtTime(freq, t);
        sGain.gain.setValueAtTime(0.001, t);
        sGain.gain.linearRampToValueAtTime(0.18, t + 0.03);
        sGain.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
        sOsc.connect(sGain);
        sGain.connect(masterGain);
        sOsc.start(t);
        sOsc.stop(t + 0.9);
      }
    }

    // Impact transient before shot cuts (beat 4, 8, 12)
    if (b === 3 || b === 7 || b === 11) {
      const riserOsc = audioCtx.createOscillator();
      const rGain = audioCtx.createGain();
      riserOsc.type = 'sawtooth';
      riserOsc.frequency.setValueAtTime(240, t + 0.15);
      riserOsc.frequency.exponentialRampToValueAtTime(960, t + 0.48);
      rGain.gain.setValueAtTime(0.01, t + 0.15);
      rGain.gain.linearRampToValueAtTime(0.14, t + 0.46);
      rGain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      riserOsc.connect(rGain);
      rGain.connect(masterGain);
      riserOsc.start(t + 0.15);
      riserOsc.stop(t + 0.51);
    }
  }

  const videoStream = canvas.captureStream(fps);
  const combinedStream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...dest.stream.getAudioTracks(),
  ]);

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
    ? 'video/webm;codecs=vp8,opus'
    : 'video/webm';

  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 2_800_000,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const recordingDone = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: 'video/webm' }));
    };
  });

  recorder.start(100);

  const drawShot = (t: number) => {
    ctx.save();
    // 4 clean beat-synced shots: [0-2s], [2-4s], [4-6s], [6-8s]
    if (t < 2.0) {
      // Shot 1: Warm Golden Hour Studio Architecture with subtle zoom-in
      const p = t / 2.0;
      const zoom = 1 + p * 0.14;
      ctx.translate(width / 2, height / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-width / 2, -height / 2);

      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, '#1e130c');
      grad.addColorStop(0.55, '#8a4b21');
      grad.addColorStop(1, '#f0a24b');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Architectural light pillars
      ctx.fillStyle = 'rgba(255, 224, 178, 0.22)';
      for (let i = 0; i < 5; i++) {
        ctx.fillRect(45 + i * 95 + p * 18, 120, 44, 720);
      }

      // Subject silhouette sphere
      ctx.beginPath();
      ctx.arc(width / 2, height * 0.48, 118, 0, Math.PI * 2);
      ctx.fillStyle = '#18100c';
      ctx.fill();
      ctx.strokeStyle = '#ffcb80';
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.restore();
      // Kinetic Title Overlay
      ctx.save();
      const alpha = Math.min(1, t * 2.5);
      ctx.globalAlpha = alpha;
      ctx.font = '700 44px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = 'rgba(0,0,0,0.65)';
      ctx.shadowBlur = 16;
      ctx.fillText('NIGHT STUDIO', width / 2, height * 0.78 - p * 14);
      ctx.restore();
    } else if (t < 4.0) {
      // Shot 2: Cool Cobalt Product Macro with diagonal pan + fast zoom
      const p = (t - 2.0) / 2.0;
      const zoom = 1.04 + p * 0.22;
      ctx.translate(width / 2 + (p - 0.5) * 35, height / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-width / 2, -height / 2);

      const grad = ctx.createLinearGradient(0, height, width, 0);
      grad.addColorStop(0, '#071124');
      grad.addColorStop(0.5, '#133a7c');
      grad.addColorStop(1, '#3b82f6');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Precision lens rings
      for (let r = 55; r <= 195; r += 35) {
        ctx.beginPath();
        ctx.arc(width / 2, height * 0.46, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(147, 197, 253, ${0.48 - r * 0.0018})`;
        ctx.lineWidth = 5;
        ctx.stroke();
      }
      ctx.restore();

      // Flash transition entry at 2.0s
      if (t - 2.0 < 0.22) {
        ctx.fillStyle = `rgba(255,255,255,${1 - (t - 2.0) / 0.22})`;
        ctx.fillRect(0, 0, width, height);
      }

      ctx.save();
      ctx.font = '700 38px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#E0F2FE';
      ctx.fillText('PRECISION CUTS', width / 2, height * 0.22);
      ctx.restore();
    } else if (t < 6.0) {
      // Shot 3: High-Contrast Crimson / Violet Editorial Drop
      const p = (t - 4.0) / 2.0;
      const pulse = 1 + Math.sin(p * Math.PI * 4) * 0.04;
      ctx.translate(width / 2, height / 2);
      ctx.scale(pulse, pulse);
      ctx.translate(-width / 2, -height / 2);

      const grad = ctx.createRadialGradient(width / 2, height * 0.45, 30, width / 2, height * 0.45, 520);
      grad.addColorStop(0, '#7c3aed');
      grad.addColorStop(0.55, '#3b0764');
      grad.addColorStop(1, '#09060e');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Graphic diagonal bars
      ctx.fillStyle = 'rgba(244, 114, 182, 0.28)';
      for (let i = -2; i < 6; i++) {
        ctx.save();
        ctx.translate(width / 2, height / 2);
        ctx.rotate(-0.35);
        ctx.fillRect(-350, i * 110 + p * 60 - 240, 700, 34);
        ctx.restore();
      }
      ctx.restore();

      ctx.save();
      ctx.font = '700 46px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText('BEAT DROP 120', width / 2, height * 0.52);
      ctx.restore();
    } else {
      // Shot 4: Emerald Dusk Minimal Closing Card with fade-out
      const p = (t - 6.0) / 2.0;
      const grad = ctx.createLinearGradient(0, 0, 0, height);
      grad.addColorStop(0, '#041f1c');
      grad.addColorStop(0.6, '#0f5149');
      grad.addColorStop(1, '#070c0e');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = 'rgba(110, 231, 183, 0.45)';
      ctx.lineWidth = 3;
      ctx.strokeRect(70, 260, width - 140, 420);

      ctx.font = '700 40px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ECFDF5';
      ctx.fillText('REEL2PREMIERE', width / 2, height * 0.48);
      ctx.font = '500 22px DM Sans, sans-serif';
      ctx.fillStyle = '#A7F3D0';
      ctx.fillText('TIMELINE READY', width / 2, height * 0.54);

      if (p > 0.72) {
        const fade = (p - 0.72) / 0.28;
        ctx.fillStyle = `rgba(0,0,0,${Math.min(1, fade)})`;
        ctx.fillRect(0, 0, width, height);
      }
      ctx.restore();
    }

    // Subtle cinematic vignette across all frames
    const vig = ctx.createRadialGradient(width / 2, height / 2, width * 0.28, width / 2, height / 2, height * 0.65);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, width, height);
  };

  const startMs = performance.now();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const elapsedSec = (performance.now() - startMs) / 1000;
      if (elapsedSec >= durationSec) {
        drawShot(durationSec);
        onProgress?.(100);
        resolve();
        return;
      }
      drawShot(elapsedSec);
      onProgress?.(Math.min(99, Math.round((elapsedSec / durationSec) * 100)));
      requestAnimationFrame(tick);
    };
    tick();
  });

  recorder.stop();
  const blob = await recordingDone;
  audioCtx.close().catch(() => {});
  videoStream.getTracks().forEach((tr) => tr.stop());

  return new File([blob], 'Sample_Vertical_Reel_120BPM.webm', {
    type: 'video/webm',
  });
}
