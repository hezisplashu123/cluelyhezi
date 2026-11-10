import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Message } from '../types/protocol';

export function ChatMessage({ message, onPress }: { message: Message; onPress?: () => void }) {
  const user = message.role === 'user';
  const content = message.content || (message.status === 'failed' ? message.error : 'Thinking…') || '';
  const label = user ? (message.source === 'speech' ? 'TRANSCRIBED QUESTION' : 'YOU') : 'OPENCLUELY';
  return <Pressable disabled={!user || !onPress} onPress={onPress} style={[s.wrap, user ? s.user : s.ai]}>
    <Text style={s.meta}>{label} · {new Date(message.createdAt).toLocaleTimeString()}</Text>
    {!!message.attachmentCount && <Text style={s.attachment}>{message.attachmentCount} saved screenshot{message.attachmentCount === 1 ? '' : 's'} · tap to reuse</Text>}
    {content.split(/(```[\s\S]*?```)/g).map((part, index) => part.startsWith('```')
      ? <Text key={index} selectable style={s.code}>{part.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}</Text>
      : <Text key={index} selectable style={s.body}>{part}</Text>)}
    {message.status === 'streaming' && <View style={s.caret} />}
  </Pressable>;
}

const s=StyleSheet.create({wrap:{marginHorizontal:14,marginVertical:6,padding:14,borderRadius:16,borderWidth:1},user:{backgroundColor:'#172554',borderColor:'#1d4ed8',marginLeft:42},ai:{backgroundColor:'#111827',borderColor:'#273244',marginRight:24},meta:{color:'#60a5fa',fontSize:10,fontWeight:'800',letterSpacing:.8,marginBottom:7},attachment:{color:'#93c5fd',fontSize:11,marginBottom:7},body:{color:'#e5e7eb',fontSize:15,lineHeight:22},code:{color:'#e2e8f0',backgroundColor:'#080b12',fontFamily:'monospace',fontSize:13,lineHeight:20,padding:10},caret:{width:7,height:14,backgroundColor:'#60a5fa',marginTop:4}});
