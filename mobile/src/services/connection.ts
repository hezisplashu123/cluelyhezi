import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import type { DesktopConfig } from '../types/protocol';

const KEY = 'opencluely.desktop.v1';
export async function loadConnection(): Promise<DesktopConfig | null> { const value = await SecureStore.getItemAsync(KEY); return value ? JSON.parse(value) : null; }
export async function saveConnection(value: DesktopConfig) { await SecureStore.setItemAsync(KEY, JSON.stringify(value)); }
export async function clearConnection() { await SecureStore.deleteItemAsync(KEY); }
export function normalizeAddress(host: string, port: string) {
  const clean = host.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!clean) throw new Error('Enter the desktop LAN address.');
  return `http://${clean.includes(':') ? clean : `${clean}:${port || '32190'}`}`;
}

export function developmentDesktopUrl(port = 32190) {
  const hostUri = Constants.expoConfig?.hostUri || Constants.expoGoConfig?.debuggerHost;
  const hostname = String(hostUri || '').replace(/^https?:\/\//, '').split(':')[0];
  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1') {
    throw new Error('Expo did not provide a reachable LAN host. Start Expo with --lan.');
  }
  return `http://${hostname}:${port}`;
}
