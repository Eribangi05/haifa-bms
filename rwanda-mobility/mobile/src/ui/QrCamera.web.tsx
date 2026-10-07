/** Web build (e2e / preview): no camera scanning, only the typed-code field on the scan screen. */
export const cameraSupported = false;
export function QrCamera(_p: { onData: (data: string) => void }) { return null; }
