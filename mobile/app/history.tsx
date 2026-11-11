import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text } from 'react-native';
import { api } from '../src/services/api';
import { loadConnection } from '../src/services/connection';

export default function History() {
  const router = useRouter(); const [items, setItems] = useState<any[]>([]); const [cursor, setCursor] = useState<string | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const load = async (older = false) => { if (busy) return; setBusy(true); try { const c = await loadConnection(); if (!c) return; const result = await api.conversations(c, older ? cursor || undefined : undefined); setItems(value => older ? [...value, ...result.items] : result.items); setCursor(result.nextCursor); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  useEffect(() => { void load(); }, []);
  const open = async (id: string) => { try { const c = await loadConnection(); if (!c) return; await api.post(c, '/api/v1/actions/select-conversation', { conversationId: id }); router.replace('/'); } catch (e: any) { setError(e.message); } };
  return <SafeAreaView style={s.page}><Text style={s.title}>Conversations</Text>{!!error && <Text style={s.error}>{error}</Text>}<FlatList data={items} keyExtractor={i => i.id} renderItem={({item}) => <Pressable style={s.row} onPress={() => open(item.id)}><Text style={s.name}>{item.title || 'Conversation'}</Text><Text style={s.date}>{new Date(item.updatedAt).toLocaleString()}</Text>{!!item.preview && <Text style={s.preview} numberOfLines={2}>{item.preview}</Text>}</Pressable>} ListFooterComponent={cursor ? <Pressable onPress={() => load(true)}><Text style={s.back}>Load older conversations</Text></Pressable> : undefined}/><Pressable onPress={() => router.back()}><Text style={s.back}>Back</Text></Pressable></SafeAreaView>;
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:'#080b12',padding:18},title:{color:'white',fontSize:28,fontWeight:'800',marginBottom:14},row:{backgroundColor:'#111827',borderColor:'#283447',borderWidth:1,borderRadius:14,padding:15,marginBottom:8},name:{color:'#e2e8f0',fontWeight:'700'},date:{color:'#64748b',marginTop:5},preview:{color:'#cbd5e1',marginTop:7},error:{color:'#fca5a5'},back:{color:'#60a5fa',textAlign:'center',padding:18}});
