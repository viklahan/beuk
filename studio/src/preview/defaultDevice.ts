/** The preview's default device (2026-11-27, V: "show Android tablet as the default in the drop down").
 *  The one id the studio reads; client/index.html's DEFAULT_DEVICE is the same and studio/test/preview-default-device.test.tsx
 *  holds the two (and the first paint below) to the page's own tables. */
export const DEFAULT_DEVICE = 'android';

/** The first paint of the device frame for DEFAULT_DEVICE, so nothing flashes another device before 1.0's setDevice runs:
 *  the frame's class, its display type (DEVICE_DISPLAY) and the footer (DEVICE_FOOTERS). Held to the page's own tables by the test. */
export const FIRST_PAINT = { frameClass: 'frame-android', display: 'lcd', footer: 'Android Tablet · 10.1 in' } as const;
