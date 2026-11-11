import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import type { DesktopConfig } from '../types/protocol';

const KEY = 'opencluely.desktop.v1';
export async function loadConnection(): Promise<DesktopConfig | null> { const value = await SecureStore.getItemAsync(KEY); return value ? JSON.parse(value) : null; }
export async function saveConnection(value: DesktopConfig) { await SecureStore.setItemAsync(KEY, JSON.stringify(value)); }
export async function clearConnection() { await SecureStore.deleteItemAsync(KEY); }
export function normalizeAddress(host: string, port: string) {
  const input = host.trim();
  const scheme = /^http:\/\//i.test(input) ? 'http' : 'https';
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
  return `https://${hostname}:${port}`;
}
