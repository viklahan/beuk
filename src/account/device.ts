/**
 * "Where you're signed in": a coarse device label from the User-Agent
 * header, such as "Firefox on Windows". No version numbers, nothing
 * finer than these buckets, and never the header itself: the label is
 * all that is stored (sessions.label, migration 025). An empty or
 * unrecognised header gives "A browser on another system".
 *
 * Order matters: Edge and Opera carry "Chrome/" too, Chrome carries
 * "Safari/", iPhone and iPad carry "like Mac OS X", and Android and
 * ChromeOS carry "Linux"/"X11". Every pattern is a plain substring
 * test, so a hostile header costs linear time.
 */

export type DeviceBrowser = 'Edge' | 'Opera' | 'Firefox' | 'Chrome' | 'Safari' | 'A browser';
export type DeviceOs = 'iPhone' | 'iPad' | 'Android' | 'ChromeOS' | 'Windows' | 'macOS' | 'Linux' | 'another system';

function browserOf(ua: string): DeviceBrowser {
  if (/\bEdg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/\bOPR\/|\bOpera\b|\bOPT\//.test(ua)) return 'Opera';
  if (/\bFirefox\/|\bFxiOS\//.test(ua)) return 'Firefox';
  if (/\bChrome\/|\bCriOS\/|\bChromium\//.test(ua)) return 'Chrome';
  if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) return 'Safari';
  return 'A browser';
}

function osOf(ua: string): DeviceOs {
  if (/\biPhone\b|\biPod\b/.test(ua)) return 'iPhone';
  if (/\biPad\b/.test(ua)) return 'iPad';
  if (/\bAndroid\b/.test(ua)) return 'Android';
  if (/\bCrOS\b/.test(ua)) return 'ChromeOS';
  if (/\bWindows\b/.test(ua)) return 'Windows';
  if (/\bMacintosh\b|\bMac OS X\b/.test(ua)) return 'macOS';
  if (/\bLinux\b|\bX11\b/.test(ua)) return 'Linux';
  return 'another system';
}

/**
 * "{Browser} on {OS}" for a User-Agent header value.
 *
 * An iPad in desktop mode (Safari's default on iPadOS 13 and later) sends
 * a Mac User-Agent, so it is labelled "Safari on macOS". That is the
 * honest answer from what the browser says about itself: don't "fix" it
 * by guessing (touch support isn't in the header, and guessing would
 * mislabel real Macs).
 */
export function deviceLabel(userAgent: string): string {
  const ua = typeof userAgent === 'string' ? userAgent : '';
  return `${browserOf(ua)} on ${osOf(ua)}`;
}
