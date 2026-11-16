import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { api } from '../src/services/api';
import { loadConnection } from '../src/services/connection';
import { Alert, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { clearConnection } from '../src/services/connection';

export default function Settings() {
  const router = useRouter();
  const [state, setState] = useState<any>(null);
  const [notice, setNotice] = useState('');
  const refresh = async () => { try { const c = await loadConnection(); if (c) setState(await api.state(c)); } catch (e: any) { setNotice(e.message); } };
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 2000); return () => clearInterval(timer); }, []);
  const command = async (path: string, body: object) => { try { const c = await loadConnection(); if (c) { await api.post(c, path, body); await refresh(); } } catch (e: any) { setNotice(e.message); } };
  const clearHistory = () => Alert.alert('Clear all history?', 'Permanently delete every conversation and saved image. New Chat keeps history.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete all', style: 'destructive', onPress: () => command('/api/v1/actions/clear-history', { confirm: true }) }]);
  return <SafeAreaView style={s.page}><ScrollView contentContainerStyle={s.content}>
    <Text style={s.title}>Settings</Text>
    {!!notice && <Text style={s.detail}>{notice}</Text>}
    <Text style={s.heading}>Interview personalization</Text>
    <Text style={s.detail}>{state?.resumeStatus?.loaded ? 'Resume context loaded' : 'Resume context not configured. Personalization is limited; save your resume in desktop Settings.'}</Text>
    <Text style={s.heading}>Audio input</Text>
    <Text style={s.detail}>Input: {state?.listening?.activeDevice?.label || state?.speech?.captureSource || 'Off'}{`\n`}Level: {Math.round((state?.speech?.diagnostics?.inputLevel || 0) * 100)}% - Voice: {state?.speech?.diagnostics?.voiceActive ? 'yes' : 'no'}{`\n`}Pending PCM: {state?.speech?.diagnostics?.pendingBytes || 0} bytes{`\n`}Noise suppression: {String(state?.listening?.activeDevice?.noiseSuppression ?? 'unknown')}{`\n`}Last transcript: {state?.speech?.diagnostics?.lastTranscription || 'None'}{`\n`}Error: {state?.listening?.error || state?.speech?.diagnostics?.captureError || 'None'}</Text>
    <Text style={s.detail}>Start Listening begins recording. The green Send button stops capture and sends one question. Pauses never submit automatically. Noise suppression depends on the computer microphone.</Text>
    <View style={s.section}><Text style={s.heading}>History</Text><Pressable style={s.forget} onPress={clearHistory}><Text style={s.buttonText}>Clear all history</Text></Pressable></View>
    <View style={s.selected}><Text style={s.selectedTitle}>Computer microphone</Text><Text style={s.body}>The phone does not capture audio. It receives live questions and streamed answers from the connected desktop.</Text></View>
    <Text style={s.detail}>Use Start Listening on the chat screen, then press the green Send button when finished.</Text>
    <View style={s.section}><Text style={s.heading}>Connection</Text><Text style={s.body}>This phone reconnects automatically using its securely stored desktop login.</Text><Pressable style={s.forget} onPress={async () => { await clearConnection(); router.replace('/pair'); }}><Text style={s.buttonText}>Forget login</Text></Pressable></View>
    <Pressable onPress={() => router.back()}><Text style={s.back}>Back</Text></Pressable>
  </ScrollView></SafeAreaView>;
}

const s=StyleSheet.create({page:{flex:1,backgroundColor:'#080b12'},content:{padding:22},title:{color:'white',fontSize:28,fontWeight:'800',marginBottom:12},heading:{color:'#f8fafc',fontSize:17,fontWeight:'800',marginVertical:12},selected:{backgroundColor:'#172554',borderColor:'#2563eb',borderWidth:1,padding:16,borderRadius:13},selectedTitle:{color:'#bfdbfe',fontWeight:'800',fontSize:16},body:{color:'#94a3b8',lineHeight:20,marginTop:5},detail:{color:'#cbd5e1',lineHeight:20,marginTop:12},buttonText:{color:'white',fontWeight:'800'},section:{borderTopWidth:1,borderTopColor:'#1e293b',marginTop:22,paddingTop:6},forget:{backgroundColor:'#7f1d1d',padding:15,borderRadius:13,marginTop:14},back:{color:'#60a5fa',textAlign:'center',marginTop:24}});
