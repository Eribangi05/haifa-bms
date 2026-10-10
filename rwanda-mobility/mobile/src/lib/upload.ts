import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { UPLOAD_JPEG_QUALITY, UPLOAD_TIMEOUT_MS, shrinkTo } from './photoCheck';
import { ApiError, type Client } from './net';

export type Picked = { uri: string; name: string; type: string; width?: number; height?: number; size?: number };

export { photoProblem } from './photoCheck';
/** `denied`: the camera/gallery permission was refused; `blocked`: the OS will not ask again, so the UI must offer "Open settings". */
export type PickResult = { file: Picked } | { cancelled: true } | { denied: true; blocked: boolean };

/** Append a picked file to FormData. Web needs a real Blob; native uses React Native's {uri,name,type} form. */
export async function appendFile(fd: FormData, field: string, f: Picked) {
  if (Platform.OS === 'web') fd.append(field, await (await fetch(f.uri)).blob(), f.name);
  else fd.append(field, { uri: f.uri, name: f.name, type: f.type } as unknown as Blob);
}

/**
 * Makes a photo light enough to send: re-saves it as JPEG at a moderate quality and, when its longest side is over 1600 px, scales it down.
 * Phone cameras produce 3 to 10 MB photos; sending those over a weak connection is the usual reason an upload "has no internet", and the server refuses over 5 MB.
 * If anything goes wrong the original file is used unchanged.
 */
export async function shrinkPhoto(f: Picked): Promise<Picked> {
  if (!f.type.startsWith('image/') || f.type === 'image/gif' || f.type === 'image/svg+xml') return f;
  try {
    let r = await ImageManipulator.manipulateAsync(f.uri, [], { compress: UPLOAD_JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG });
    const to = shrinkTo(r.width, r.height);
    if (to) r = await ImageManipulator.manipulateAsync(f.uri, [{ resize: to.width >= to.height ? { width: to.width } : { height: to.height } }], { compress: UPLOAD_JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG });
    return { ...f, uri: r.uri, type: 'image/jpeg', name: f.name.replace(/\.\w+$/, '') + '.jpg', width: r.width, height: r.height, size: undefined };
  } catch { return f; }
}

/** The file as base64 text (for the JSON fallback of an upload). Works for file:// and content:// uris and in the browser. */
export async function readBase64(uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  return await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onerror = () => reject(r.error); r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, '')); r.readAsDataURL(blob); });
}

/**
 * Uploads one file. First as a normal multipart request. If the phone loses the connection in the middle of it (which some phones and networks do with multipart
 * bodies even when ordinary requests work), the same file is sent again as JSON (base64), which takes the same road as every other call of the app.
 * The server accepts both forms on the upload routes and applies the same checks and the 5 MB limit.
 */
export async function uploadFile<T = any>(client: Client, path: string, fields: Record<string, string | undefined>, f: Picked, timeoutMs = UPLOAD_TIMEOUT_MS): Promise<T> {
  const clean: Record<string, string> = {}; for (const [k, v] of Object.entries(fields)) if (v) clean[k] = v;
  try {
    const fd = new FormData(); for (const [k, v] of Object.entries(clean)) fd.append(k, v); await appendFile(fd, 'file', f);
    return await client.post<T>(path, undefined, { form: fd, timeoutMs, retry: true, maxRetries: 1 });
  } catch (e) {
    if (!(e instanceof ApiError) || (e.code !== 'network' && e.code !== 'timeout')) throw e;
    const data = await readBase64(f.uri);
    return await client.post<T>(path, { ...clean, mime: f.type, data_base64: data }, { timeoutMs, retry: true, maxRetries: 1 });
  }
}

export async function pickPhoto(source: 'camera' | 'gallery'): Promise<PickResult> {
  const r = await pickPhotoRaw(source); return 'file' in r ? { file: await shrinkPhoto(r.file) } : r;
}
async function pickPhotoRaw(source: 'camera' | 'gallery'): Promise<PickResult> {
  if (source === 'camera') {
    const p = await ImagePicker.requestCameraPermissionsAsync(); if (!p.granted) return { denied: true, blocked: p.canAskAgain === false };
    const r = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    return r.canceled ? { cancelled: true } : { file: { uri: r.assets[0].uri, name: 'photo.jpg', type: 'image/jpeg', width: r.assets[0].width, height: r.assets[0].height, size: r.assets[0].fileSize } };
  }
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
  return r.canceled ? { cancelled: true } : { file: { uri: r.assets[0].uri, name: 'photo.jpg', type: r.assets[0].mimeType ?? 'image/jpeg', width: r.assets[0].width, height: r.assets[0].height, size: r.assets[0].fileSize } };
}
