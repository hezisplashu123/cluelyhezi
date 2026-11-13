import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { ChatMessage } from '../src/components/ChatMessage';
import { useDesktopConnection } from '../src/hooks/useDesktopConnection';
import { clearConnection } from '../src/services/connection';
import type { Message } from '../src/types/protocol';

export default function Dashboard() {
  const router = useRouter();
  const desktop = useDesktopConnection();
  const list = useRef<FlatList<Message>>(null);
  const nearBottom = useRef(true);
  const pendingQuestion = useRef<{ content: string; requestId: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [micIntent, setMicIntent] = useState<boolean | null>(null);
  const micCommand = useRef(0);

  useEffect(() => {
    if (!desktop.loading && !desktop.config) router.replace('/pair');
  }, [desktop.loading, desktop.config, router]);

  const listening = desktop.state?.listening;
  const speech = desktop.state?.speech;
  const canonicalMicOn = listening
    ? listening.desiredOn && listening.source === 'microphone' && listening.state !== 'OFF' && listening.state !== 'ERROR'
    : !!speech?.isRecording && speech.captureSource === 'microphone';
  const shownMicOn = micIntent ?? canonicalMicOn;

  useEffect(() => {
    if (micIntent !== null && canonicalMicOn === micIntent) setMicIntent(null);
  }, [canonicalMicOn, micIntent]);

  const run = async (path: string, body: object = {}) => {
    if (busy) return false;
    setBusy(true); setNotice('');
    try { await desktop.action(path, body); return true; }
    catch (error: any) { setNotice(error.message); return false; }
    finally { setBusy(false); }
  };

  const ask = async () => {
    const content = draft.trim();
    if (!content) return;
    if (pendingQuestion.current?.content !== content) {
      pendingQuestion.current = { content, requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}` };
    }
    if (await run('/api/v1/messages', { content, requestId: pendingQuestion.current.requestId })) {
      pendingQuestion.current = null; setDraft('');
    }
  };

  const toggleComputerMicrophone = async () => {
    if (!desktop.connected) return;
    const enabled = !shownMicOn;
    const command = ++micCommand.current;
    setMicIntent(enabled);
    setNotice('');
    try {
      await desktop.action('/api/v1/actions/computer-microphone', { enabled });
    } catch (error: any) {
      // A newer tap owns the UI now; do not let an older request roll it back.
      if (command === micCommand.current) {
        setMicIntent(null);
        setNotice(error.message);
      }
    }
  };

  if (desktop.loading || !desktop.config) return <View style={s.page} />;

  const count = desktop.state?.screenshotQueueCount || 0;
  const computerMicListening = listening
    ? listening.state === 'LISTENING' && listening.source === 'microphone'
    : !!speech?.isRecording && speech.captureSource === 'microphone';
  const otherDesktopAudioListening = listening
    ? listening.desiredOn && listening.source !== 'microphone'
    : !!speech?.isRecording && speech.captureSource !== 'microphone';
  const micStarting = micIntent === true || (micIntent === null && listening?.state === 'STARTING' && listening.source === 'microphone');
  const micStopping = micIntent === false || (micIntent === null && listening?.state === 'STOPPING' && listening.source === 'microphone');
  const receiverStatus = !desktop.connected
    ? 'Disconnected - reconnecting'
    : micStarting
      ? 'Starting computer microphone'
      : micStopping
        ? 'Stopping computer microphone'
        : computerMicListening
      ? 'Computer microphone listening'
      : otherDesktopAudioListening
        ? 'Another desktop audio source is active'
        : listening?.state === 'ERROR'
          ? `Microphone error: ${listening.error || 'unknown error'}`
          : 'Computer microphone paused';
  const micButtonText = micStarting
    ? 'Starting… Tap to stop'
    : micStopping
      ? 'Stopping… Tap to start'
      : shownMicOn
        ? 'Stop Computer Microphone'
        : otherDesktopAudioListening
          ? 'Switch to Computer Microphone'
          : 'Start Computer Microphone';

  return <SafeAreaView style={s.page}><KeyboardAvoidingView style={s.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <View style={s.header}><View style={s.headerCopy}><Text style={s.title}>YashOpenClue</Text><Text style={s.status}>{receiverStatus}</Text></View><View>{!desktop.connected && <Pressable onPress={async () => { await clearConnection(); desktop.updateConfig(null); router.replace('/pair'); }}><Text style={s.link}>Log in</Text></Pressable>}<Pressable onPress={() => router.push('/settings')}><Text style={s.link}>Settings</Text></Pressable></View></View>
    <View style={s.receiver}><Text style={s.receiverTitle}>Phone receiver</Text><Text style={s.receiverText}>Audio is captured by your computer microphone. Questions and answers appear here live.</Text></View>
    {!!(notice || desktop.error) && <Text style={s.error}>{notice || desktop.error}</Text>}
    <FlatList ref={list} data={desktop.messages} keyExtractor={item => item.id} renderItem={({ item }) => <ChatMessage message={item} />} contentContainerStyle={s.messages} ListHeaderComponent={desktop.hasOlder ? <Pressable onPress={desktop.loadOlder}><Text style={s.link}>Load earlier messages</Text></Pressable> : undefined} onScroll={e => { const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent; nearBottom.current = contentSize.height - layoutMeasurement.height - contentOffset.y < 80; }} scrollEventThrottle={100} onContentSizeChange={() => { if (nearBottom.current) list.current?.scrollToEnd({ animated: false }); }} />
    {!!desktop.interim && <Text style={s.interim}>Hearing: {desktop.interim}</Text>}
    <View style={s.controls}>
      <Pressable accessibilityRole="button" accessibilityLabel={shownMicOn ? 'Stop computer microphone' : 'Start computer microphone'} disabled={!desktop.connected} onPress={toggleComputerMicrophone} style={[s.mic, shownMicOn && s.micActive, !desktop.connected && { opacity: .5 }]}><Text style={s.buttonText}>{micButtonText}</Text></Pressable>
      <View style={s.row}><TextInput value={draft} onChangeText={setDraft} multiline placeholder="Ask a follow-up..." placeholderTextColor="#64748b" style={s.input} /><Pressable disabled={!desktop.connected || busy || !draft.trim()} onPress={ask} style={s.send}><Text style={s.buttonText}>Send</Text></Pressable></View>
      <View style={s.tools}><Pressable onPress={() => router.push('/history')}><Text style={s.link}>History</Text></Pressable><Pressable disabled={!desktop.connected || busy} onPress={() => run('/api/v1/actions/new-conversation')}><Text style={s.link}>New conversation</Text></Pressable><Pressable disabled={!desktop.connected || busy} onPress={() => run('/api/v1/actions/capture')}><Text style={s.link}>Screenshot</Text></Pressable>{count > 0 && <Pressable disabled={!desktop.connected || busy} onPress={() => run('/api/v1/actions/submit')}><Text style={s.link}>Analyze ({count})</Text></Pressable>}</View>
    </View>
  </KeyboardAvoidingView></SafeAreaView>;
}

const s = StyleSheet.create({page:{flex:1,backgroundColor:'#080b12'},header:{padding:16,flexDirection:'row',justifyContent:'space-between',alignItems:'center',borderBottomWidth:1,borderBottomColor:'#1e293b'},headerCopy:{flex:1,paddingRight:8},title:{color:'#f8fafc',fontSize:20,fontWeight:'800'},status:{color:'#94a3b8',fontSize:12,marginTop:4},receiver:{backgroundColor:'#0f172a',paddingHorizontal:16,paddingVertical:10,borderBottomWidth:1,borderBottomColor:'#1e293b'},receiverTitle:{color:'#93c5fd',fontSize:12,fontWeight:'800'},receiverText:{color:'#94a3b8',fontSize:12,lineHeight:17,marginTop:2},link:{color:'#60a5fa',padding:7,fontSize:12},error:{color:'#fca5a5',paddingHorizontal:16,paddingVertical:8},messages:{paddingVertical:12},interim:{color:'#bfdbfe',fontStyle:'italic',paddingHorizontal:18,paddingBottom:8},controls:{padding:12,borderTopWidth:1,borderTopColor:'#1e293b',gap:9},mic:{backgroundColor:'#2563eb',borderRadius:14,padding:15,alignItems:'center'},micActive:{backgroundColor:'#b91c1c'},buttonText:{color:'white',fontWeight:'800'},row:{flexDirection:'row',gap:8,alignItems:'flex-end'},input:{flex:1,maxHeight:110,minHeight:44,color:'white',backgroundColor:'#111827',borderColor:'#334155',borderWidth:1,borderRadius:12,paddingHorizontal:12,paddingVertical:10},send:{backgroundColor:'#334155',borderRadius:12,paddingHorizontal:17,paddingVertical:13},tools:{flexDirection:'row',justifyContent:'space-between',flexWrap:'wrap'}});
