import { useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { assistantModeLabel } from '../constants/assistantModes';
import { parts } from '../../../lib/plain-response';
import type { DesktopConfig, Message } from '../types/protocol';

export function ChatMessage({ message, onPress, config }: { message: Message; onPress?: () => void; config?: DesktopConfig | null }) {
  const [preview, setPreview] = useState<string | null>(null);
  const user = message.role === 'user';
  const content = message.content || (user ? '' : message.status === 'failed' ? message.error : message.status === 'interrupted' ? 'Response interrupted. Ask again to retry.' : 'Thinking…') || '';
  const label = user ? (message.source === 'speech' || message.source === 'mobile_voice' ? 'SPOKEN QUESTION' : 'YOU') : 'OPENCLUELY';
  return <Pressable disabled={!user || !onPress} onPress={onPress} style={[s.wrap, user ? s.user : s.ai]}>
    <Text style={s.meta}>{label} · {new Date(message.createdAt).toLocaleTimeString()}</Text>
    {!!message.metadata?.mode && <Text style={s.attachment}>{assistantModeLabel(message.metadata.mode)}</Text>}
    {!!config && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{message.attachments?.map(image => <Pressable key={image.id} onPress={() => setPreview(image.id)}><Image accessibilityLabel="Attached image; tap to enlarge" source={{ uri: `${config.baseUrl}/api/v1/attachments/${image.id}/thumbnail`, headers: { Authorization: `Bearer ${config.token}` } }} style={{ width: 110, height: 90, borderRadius: 8 }} /></Pressable>)}</View>}
    <Modal visible={!!preview} transparent onRequestClose={() => setPreview(null)}><View style={{ flex: 1, backgroundColor: '#000e', justifyContent: 'center' }}>{config && preview && <Image resizeMode="contain" source={{ uri: `${config.baseUrl}/api/v1/attachments/${preview}/original`, headers: { Authorization: `Bearer ${config.token}` } }} style={{ width: '100%', height: '80%' }} />}<Pressable onPress={() => setPreview(null)}><Text style={{ color: 'white', padding: 20, textAlign: 'center' }}>Close image</Text></Pressable></View></Modal>
    {!!message.attachmentCount && <Text style={s.attachment}>{message.attachmentCount} saved image{message.attachmentCount === 1 ? '' : 's'}</Text>}
    {parts(content, { plain: !user }).map((part, index) => <Text key={index} selectable style={part.kind === 'code' ? s.code : s.body}>{part.content}</Text>)}
    {message.status === 'streaming' && <View style={s.caret} />}
    {message.status === 'failed' && !!message.content && <Text style={s.attachment}>Answer failed: {message.error || 'Unknown error'}</Text>}
    {message.status === 'interrupted' && !!message.content && <Text style={s.attachment}>Response interrupted.</Text>}
  </Pressable>;
}

const s=StyleSheet.create({wrap:{marginHorizontal:14,marginVertical:6,padding:14,borderRadius:16,borderWidth:1},user:{backgroundColor:'#172554',borderColor:'#1d4ed8',marginLeft:42},ai:{backgroundColor:'#111827',borderColor:'#273244',marginRight:24},meta:{color:'#60a5fa',fontSize:10,fontWeight:'800',letterSpacing:.8,marginBottom:7},attachment:{color:'#93c5fd',fontSize:11,marginBottom:7},body:{color:'#e5e7eb',fontSize:15,lineHeight:22},code:{color:'#e2e8f0',backgroundColor:'#080b12',fontFamily:'monospace',fontSize:13,lineHeight:20,padding:10},caret:{width:7,height:14,backgroundColor:'#60a5fa',marginTop:4}});
