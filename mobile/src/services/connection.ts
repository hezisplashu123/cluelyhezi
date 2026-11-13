import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import type { DesktopConfig } from '../types/protocol';

const KEY = 'opencluely.desktop.v1';
export async function loadConnection(): Promise<DesktopConfig | null> {
  const value = await SecureStore.getItemAsync(KEY);
  if (!value) return null;
  const config = JSON.parse(value) as DesktopConfig;
  // Tokens saved by the previous HTTPS bridge remain valid. Migrate only the
  // transport so Expo Go no longer encounters its untrusted certificate.
  const baseUrl = config.baseUrl.replace(/^https:\/\//i, 'http://');
  if (baseUrl !== config.baseUrl) await saveConnection({ ...config, baseUrl });
  return { ...config, baseUrl };
}
export async function saveConnection(value: DesktopConfig) { await SecureStore.setItemAsync(KEY, JSON.stringify(value)); }
export async function clearConnection() { await SecureStore.deleteItemAsync(KEY); }
export function normalizeAddress(host: string, port: string) {
  const input = host.trim();
  const scheme = 'http';
  const clean = input.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  if (!clean) throw new Error('Enter the desktop LAN address.');
  return `${scheme}://${clean.includes(':') ? clean : `${clean}:${port || '32190'}`}`;
}

export function developmentDesktopUrl(port = 32190) {
  const hostUri = Constants.expoConfig?.hostUri || Constants.expoGoConfig?.debuggerHost;
  const hostname = String(hostUri || '').replace(/^https?:\/\//, '').split(':')[0];
  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') {
    throw new Error('Expo did not provide a reachable LAN host. Start Expo with --lan.');
  }
  return `http://${hostname}:${port}`;
}
