import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChatMessage } from '../src/components/ChatMessage';
import { useDesktopConnection } from '../src/hooks/useDesktopConnection';
import type { Message } from '../src/types/protocol';

export default function Dashboard() {
  const router = useRouter();
  const desktop = useDesktopConnection();
  const list = useRef<FlatList<Message>>(null);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(false);
  const [draft, setDraft] = useState('');
  const [reusedQuestion, setReusedQuestion] = useState<Message | null>(null);
  const [crop, setCrop] = useState({ x: '0', y: '0', width: '100', height: '100' });

  useEffect(() => { if (!desktop.loading && !desktop.config) router.replace('/pair'); }, [desktop.loading, desktop.config]);

  const run = async (path: string, body: any = {}) => {
    if (busyRef.current) return null;
    busyRef.current = true; setBusy(true); setNotice('');
    try { return await desktop.action(path, body); }
    catch (error: any) { setNotice(error.message); return null; }
    finally { busyRef.current = false; setBusy(false); }
  };

  const chooseQuestion = (message: Message) => {
    setDraft(message.content);
    setReusedQuestion(message.attachmentCount ? message : null);
  };

  const ask = async () => {
    const content = draft.trim();
    if (!content) return;
    const result = await run('/api/v1/messages', {
      content,
      contextMode: 'current',
      ...(reusedQuestion?.attachmentCount ? { attachmentMessageId: reusedQuestion.id } : {})
    });
    if (result) { setDraft(''); setReusedQuestion(null); }
  };

  if (desktop.loading || !desktop.config) return <View style={s.page} />;
  const count = desktop.state?.screenshotQueueCount || 0;

  return <SafeAreaView style={s.page}>
    <KeyboardAvoidingView style={s.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.header}>
        <View><Text style={s.status}>{desktop.connected ? '● Connected' : '○ Reconnecting'}</Text><Text style={s.target}>{desktop.state?.selectedTarget?.displayName || 'VMware · automatic'}</Text></View>
        <Pressable onPress={() => { const saved = desktop.state?.selectedTarget?.crop; setCrop(saved ? { x: String(saved.x * 100), y: String(saved.y * 100), width: String(saved.width * 100), height: String(saved.height * 100) } : { x: '0', y: '0', width: '100', height: '100' }); setSettings(true); }}><Text style={s.link}>Settings</Text></Pressable>
      </View>
      {!!(notice || desktop.error) && <Text style={s.error}>{notice || desktop.error}</Text>}
      <FlatList ref={list} data={desktop.messages} keyExtractor={message => message.id} renderItem={({ item }) => <ChatMessage message={item} onPress={item.role === 'user' ? () => chooseQuestion(item) : undefined} />} onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })} contentContainerStyle={s.messages} />
      <View style={s.composer}>
        {!!reusedQuestion?.attachmentCount && <View style={s.contextPill}><Text style={s.contextText}>Using {reusedQuestion.attachmentCount} saved screenshot{reusedQuestion.attachmentCount === 1 ? '' : 's'} as context</Text><Pressable onPress={() => setReusedQuestion(null)}><Text style={s.contextRemove}>Remove</Text></Pressable></View>}
        <View style={s.composeRow}>
          <TextInput value={draft} onChangeText={setDraft} multiline placeholder="Ask a follow-up question…" placeholderTextColor="#64748b" style={s.questionInput} />
          <Pressable disabled={!desktop.connected || busy || !draft.trim()} onPress={ask} style={[s.ask, (!desktop.connected || busy || !draft.trim()) && s.disabled]}><Text style={s.buttonText}>Ask</Text></Pressable>
        </View>
      </View>
      <View style={s.bottom}>
        <Text style={s.count}>{count} screenshot{count === 1 ? '' : 's'} queued on desktop</Text>
        <View style={s.row}><Pressable disabled={!desktop.connected || busy} onPress={() => run('/api/v1/actions/capture')} style={[s.capture, (!desktop.connected || busy) && s.disabled]}><Text style={s.buttonText}>Capture Screenshot</Text></Pressable><Pressable disabled={!desktop.connected || busy || !count || !!desktop.state?.activeAIRequest} onPress={() => run('/api/v1/actions/submit')} style={[s.send, (!desktop.connected || busy || !count || !!desktop.state?.activeAIRequest) && s.disabled]}><Text style={s.buttonText}>{desktop.state?.activeAIRequest ? 'Processing…' : 'Send'}</Text></Pressable></View>
      </View>
      <Modal visible={settings} transparent animationType="slide" onRequestClose={() => setSettings(false)}><View style={s.shade}><View style={s.sheet}>
        <Text style={s.title}>Capture target</Text><Text style={s.hint}>Choose a VMware window, or explicitly choose a host monitor.</Text>
        <ScrollView>{desktop.state?.targets?.map(target => <Pressable key={target.sourceId} style={s.option} onPress={async () => { await run('/api/v1/actions/select-target', { sourceId: target.sourceId }); setSettings(false); }}><Text style={s.optionText}>{target.kind === 'screen' ? 'Monitor · ' : 'VMware · '}{target.displayName}</Text></Pressable>)}<Text style={s.hint}>Optional viewport crop (%): left, top, width, height.</Text><View style={s.row}>{(['x', 'y', 'width', 'height'] as const).map(key => <TextInput key={key} accessibilityLabel={key} keyboardType="decimal-pad" value={crop[key]} onChangeText={value => setCrop(current => ({ ...current, [key]: value }))} style={s.cropInput} />)}</View><View style={s.row}><Pressable onPress={() => run('/api/v1/actions/set-crop', { crop: { x: Number(crop.x) / 100, y: Number(crop.y) / 100, width: Number(crop.width) / 100, height: Number(crop.height) / 100 } })}><Text style={s.link}>Save crop</Text></Pressable><Pressable onPress={() => run('/api/v1/actions/set-crop', { crop: null })}><Text style={s.link}>Use full window</Text></Pressable></View></ScrollView>
        <Pressable onPress={() => { setSettings(false); router.push('/settings'); }}><Text style={s.link}>Connection</Text></Pressable><Pressable onPress={() => setSettings(false)}><Text style={s.link}>Close</Text></Pressable>
      </View></View></Modal>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const s = StyleSheet.create({page:{flex:1,backgroundColor:'#080b12'},header:{padding:16,flexDirection:'row',justifyContent:'space-between',alignItems:'center',borderBottomWidth:1,borderBottomColor:'#1e293b'},status:{color:'#86efac',fontSize:12},target:{color:'#e2e8f0',fontWeight:'700',marginTop:5},link:{color:'#60a5fa',padding:10},error:{color:'#fca5a5',padding:10},messages:{paddingVertical:12},composer:{paddingHorizontal:12,paddingTop:8,borderTopWidth:1,borderTopColor:'#1e293b'},composeRow:{flexDirection:'row',gap:8,alignItems:'flex-end'},questionInput:{flex:1,maxHeight:110,minHeight:44,color:'white',backgroundColor:'#111827',borderColor:'#334155',borderWidth:1,borderRadius:12,paddingHorizontal:12,paddingVertical:10},ask:{backgroundColor:'#2563eb',borderRadius:12,paddingHorizontal:17,paddingVertical:13},contextPill:{flexDirection:'row',justifyContent:'space-between',backgroundColor:'#172554',borderRadius:9,paddingHorizontal:10,paddingVertical:7,marginBottom:7},contextText:{color:'#bfdbfe',fontSize:12},contextRemove:{color:'#93c5fd',fontWeight:'700',fontSize:12},bottom:{padding:12},count:{color:'#94a3b8',fontSize:12,marginBottom:8},row:{flexDirection:'row',gap:10},cropInput:{flex:1,color:'white',borderColor:'#475569',borderWidth:1,borderRadius:8,padding:8},capture:{flex:1,backgroundColor:'#2563eb',borderRadius:12,padding:15,alignItems:'center'},send:{backgroundColor:'#334155',borderRadius:12,padding:15,alignItems:'center',minWidth:90},disabled:{opacity:.45},buttonText:{color:'white',fontWeight:'800'},shade:{flex:1,backgroundColor:'#000d',justifyContent:'flex-end'},sheet:{maxHeight:'80%',backgroundColor:'#111827',padding:20,borderTopLeftRadius:20,borderTopRightRadius:20},title:{color:'white',fontSize:21,fontWeight:'800'},hint:{color:'#94a3b8',marginVertical:12},option:{padding:13,borderBottomWidth:1,borderBottomColor:'#334155'},optionText:{color:'#e2e8f0'}});
