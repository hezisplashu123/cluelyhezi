import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../src/services/api';
import { developmentDesktopUrl, normalizeAddress, saveConnection } from '../src/services/connection';

export default function PairScreen() {
  const router = useRouter();
  const [address, setAddress] = useState(() => {
    try { return developmentDesktopUrl(); } catch { return ''; }
  });
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      const baseUrl = normalizeAddress(address, '32190');
      const result = await api.login(baseUrl, password);
      await saveConnection({ baseUrl, token: result.token, device: result.device });
      router.replace('/');
    } catch (failure: any) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  return <View style={s.page}>
    <Text style={s.title}>Connect to your desktop</Text>
    <Text style={s.help}>Enter password 9898 once. This phone securely saves its login and reconnects automatically next time.</Text>
    <TextInput value={address} onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} placeholder="Desktop address, e.g. 192.168.1.10:32190" placeholderTextColor="#64748b" style={s.input}/>
    <TextInput value={password} onChangeText={setPassword} keyboardType="number-pad" secureTextEntry maxLength={4} placeholder="Phone password" placeholderTextColor="#64748b" style={s.input}/>
    {!!error && <Text style={s.error}>{error}</Text>}
    <Pressable disabled={busy || password.length !== 4} onPress={connect} style={[s.button, (busy || password.length !== 4) && { opacity: .5 }]}>
      <Text style={s.buttonText}>{busy ? 'Connecting…' : 'Connect'}</Text>
    </Pressable>
  </View>;
}

const s = StyleSheet.create({
  page: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#080b12' },
  title: { color: 'white', fontSize: 26, fontWeight: '800' },
  help: { color: '#94a3b8', lineHeight: 22, marginVertical: 18 },
  input: { color: 'white', backgroundColor: '#111827', borderColor: '#334155', borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 },
  error: { color: '#fca5a5', marginBottom: 10 },
  button: { backgroundColor: '#2563eb', borderRadius: 12, padding: 15, alignItems: 'center' },
  buttonText: { color: 'white', fontWeight: '800' }
});
