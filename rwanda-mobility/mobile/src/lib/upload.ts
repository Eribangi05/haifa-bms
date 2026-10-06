import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export type Picked = { uri: string; name: string; type: string };

/** Append a picked file to FormData. Web needs a real Blob; native uses React Native's {uri,name,type} form. */
export async function appendFile(fd: FormData, field: string, f: Picked) {
  if (Platform.OS === 'web') fd.append(field, await (await fetch(f.uri)).blob(), f.name);
  else fd.append(field, { uri: f.uri, name: f.name, type: f.type } as any);
}

export async function pickPhoto(source: 'camera' | 'gallery'): Promise<Picked | null> {
  if (source === 'camera') {
    const p = await ImagePicker.requestCameraPermissionsAsync(); if (!p.granted) return null;
    const r = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    return r.canceled ? null : { uri: r.assets[0].uri, name: 'photo.jpg', type: 'image/jpeg' };
  }
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
  return r.canceled ? null : { uri: r.assets[0].uri, name: 'photo.jpg', type: r.assets[0].mimeType ?? 'image/jpeg' };
}
