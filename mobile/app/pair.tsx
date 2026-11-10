import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../src/services/api';
import { developmentDesktopUrl, normalizeAddress, saveConnection } from '../src/services/connection';
export default function PairScreen() {
  const router = useRouter();
  const [address, setAddress] = useState(() => { try { return developmentDesktopUrl(); } catch { return ''; } });
  const [code, setCode] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const connect = async () => { setBusy(true); setError(''); try {
    const baseUrl = normalizeAddress(address, '32190'); const result = await api.pair(baseUrl, code);
    await saveConnection({ baseUrl, token: result.token, device: result.device }); router.replace('/');
  } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  return <View style={s.page}><Text style={s.title}>One-time desktop setup</Text><Text style={s.help}>Enter the desktop LAN address and pairing code once. This phone will store the credential securely and reconnect automatically afterward.</Text><TextInput value={address} onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} placeholder="Desktop address, e.g. 192.168.1.10:32190" placeholderTextColor="#64748b" style={s.input}/><TextInput value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} placeholder="Six-digit pairing code" placeholderTextColor="#64748b" style={s.input}/>{!!error && <Text style={s.error}>{error}</Text>}<Pressable disabled={busy || code.length !== 6} onPress={connect} style={[s.button, (busy || code.length !== 6) && {opacity: .5}]}><Text style={s.buttonText}>{busy ? 'Connecting…' : 'Pair desktop once'}</Text></Pressable></View>;
}
const s = StyleSheet.create({page:{flex:1,justifyContent:'center',padding:24,backgroundColor:'#080b12'},title:{color:'white',fontSize:26,fontWeight:'800'},help:{color:'#94a3b8',lineHeight:22,marginVertical:18},input:{color:'white',backgroundColor:'#111827',borderColor:'#334155',borderWidth:1,borderRadius:12,padding:14,marginBottom:12},error:{color:'#fca5a5',marginBottom:10},button:{backgroundColor:'#2563eb',borderRadius:12,padding:15,alignItems:'center'},buttonText:{color:'white',fontWeight:'800'}});
