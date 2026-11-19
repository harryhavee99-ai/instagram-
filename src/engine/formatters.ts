import type { ColorGradeSettings } from '../types/project';

export function formatTimecodeMs(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad3 = (n: number) => String(Math.min(999, n)).padStart(3, '0');
  return `${pad2(hrs)}:${pad2(mins)}:${pad2(secs)}.${pad3(ms)}`;
}

export function formatSmpte(seconds: number, fps = 30): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalFrames = Math.round(safe * fps);
  const frame = totalFrames % Math.round(fps);
  const totalSec = Math.floor(totalFrames / Math.round(fps));
  const secs = totalSec % 60;
  const mins = Math.floor(totalSec / 60) % 60;
  const hrs = Math.floor(totalSec / 3600);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  return `${pad2(hrs)}:${pad2(mins)}:${pad2(secs)}:${pad2(frame)}`;
}

export function formatShortSec(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${safe.toFixed(2)}s`;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function computeAspectRatio(width: number, height: number): string {
  if (!width || !height) return '16:9';
  const ratio = width / height;
  if (Math.abs(ratio - 9 / 16) < 0.04) return '9:16';
  if (Math.abs(ratio - 16 / 9) < 0.04) return '16:9';
  if (Math.abs(ratio - 4 / 5) < 0.04) return '4:5';
  if (Math.abs(ratio - 1) < 0.04) return '1:1';
  if (Math.abs(ratio - 4 / 3) < 0.04) return '4:3';
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(Math.round(width), Math.round(height));
  return `${Math.round(width / g)}:${Math.round(height / g)}`;
}

export function buildColorFilterCss(grade: ColorGradeSettings): string {
  const brightness = Math.max(0.35, Math.min(2.2, 1 + grade.exposure * 0.25 + (grade.highlights - grade.shadows) * 0.001));
  const contrast = Math.max(0.4, Math.min(2.2, 1 + grade.contrast * 0.0075 + (grade.whites - grade.blacks) * 0.0015));
  const saturate = Math.max(0, Math.min(2.5, (grade.saturation / 100) * (1 + grade.vibrance * 0.003)));
  const sepia = grade.temperature > 0 ? Math.min(0.42, grade.temperature * 0.0035) : 0;
  const hueRotate = grade.hueShift + (grade.temperature < 0 ? grade.temperature * 0.16 : 0) + grade.tint * 0.14;
  return `brightness(${brightness.toFixed(3)}) contrast(${contrast.toFixed(3)}) saturate(${saturate.toFixed(3)}) sepia(${sepia.toFixed(3)}) hue-rotate(${hueRotate.toFixed(1)}deg)`;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function inferContainerAndCodec(file: File): { container: string; codec: string } {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const mime = (file.type || '').toLowerCase();

  if (ext === 'mov' || mime.includes('quicktime')) {
    return {
      container: 'QuickTime MOV',
      codec: file.name.toLowerCase().includes('prores') ? 'Apple ProRes 422 / H.264' : 'H.264 / HEVC (QuickTime)',
    };
  }
  if (ext === 'webm' || mime.includes('webm')) {
    return { container: 'WebM', codec: 'VP9 / VP8 + Opus' };
  }
  if (ext === 'mkv' || mime.includes('matroska')) {
    return { container: 'Matroska MKV', codec: 'H.264 / HEVC (MKV)' };
  }
  if (ext === 'avi' || mime.includes('avi')) {
    return { container: 'AVI', codec: 'MPEG-4 / Motion JPEG' };
  }
  if (ext === 'm4v') {
    return { container: 'M4V', codec: 'H.264 / AAC' };
  }
  if (ext === 'mpeg' || ext === 'mpg') {
    return { container: 'MPEG', codec: 'MPEG-2 / H.264' };
  }
  return { container: 'MP4 (ISO BMFF)', codec: 'H.264 / AVC + AAC' };
}
