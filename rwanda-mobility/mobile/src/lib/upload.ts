import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export type Picked = { uri: string; name: string; type: string; width?: number; height?: number; size?: number };

export { photoProblem } from './photoCheck';
/** `denied`: the camera/gallery permission was refused; `blocked`: the OS will not ask again, so the UI must offer "Open settings". */
export type PickResult = { file: Picked } | { cancelled: true } | { denied: true; blocked: boolean };

/** Append a picked file to FormData. Web needs a real Blob; native uses React Native's {uri,name,type} form. */
export async function appendFile(fd: FormData, field: string, f: Picked) {
  if (Platform.OS === 'web') fd.append(field, await (await fetch(f.uri)).blob(), f.name);
  else fd.append(field, { uri: f.uri, name: f.name, type: f.type } as unknown as Blob);
}

export async function pickPhoto(source: 'camera' | 'gallery'): Promise<PickResult> {
  if (source === 'camera') {
    const p = await ImagePicker.requestCameraPermissionsAsync(); if (!p.granted) return { denied: true, blocked: p.canAskAgain === false };
    const r = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    return r.canceled ? { cancelled: true } : { file: { uri: r.assets[0].uri, name: 'photo.jpg', type: 'image/jpeg', width: r.assets[0].width, height: r.assets[0].height, size: r.assets[0].fileSize } };
  }
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
  return r.canceled ? { cancelled: true } : { file: { uri: r.assets[0].uri, name: 'photo.jpg', type: r.assets[0].mimeType ?? 'image/jpeg', width: r.assets[0].width, height: r.assets[0].height, size: r.assets[0].fileSize } };
}
