import { useRouter } from 'expo-router';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { clearConnection } from '../src/services/connection';

export default function Settings() {
  const router = useRouter();
  return <SafeAreaView style={s.page}><ScrollView contentContainerStyle={s.content}>
    <Text style={s.title}>Settings</Text>
    <Text style={s.heading}>Audio input</Text>
    <View style={s.selected}><Text style={s.selectedTitle}>Computer microphone</Text><Text style={s.body}>The phone does not capture audio. It receives live questions and streamed answers from the paired desktop.</Text></View>
    <Text style={s.detail}>Use the Start Computer Microphone button on the receiver screen to start or stop listening on the computer.</Text>
    <View style={s.section}><Text style={s.heading}>Connection</Text><Text style={s.body}>This phone reconnects automatically using its securely stored desktop credential.</Text><Pressable style={s.forget} onPress={async () => { await clearConnection(); router.replace('/pair'); }}><Text style={s.buttonText}>Forget and pair again</Text></Pressable></View>
    <Pressable onPress={() => router.back()}><Text style={s.back}>Back</Text></Pressable>
  </ScrollView></SafeAreaView>;
}

const s=StyleSheet.create({page:{flex:1,backgroundColor:'#080b12'},content:{padding:22},title:{color:'white',fontSize:28,fontWeight:'800',marginBottom:12},heading:{color:'#f8fafc',fontSize:17,fontWeight:'800',marginVertical:12},selected:{backgroundColor:'#172554',borderColor:'#2563eb',borderWidth:1,padding:16,borderRadius:13},selectedTitle:{color:'#bfdbfe',fontWeight:'800',fontSize:16},body:{color:'#94a3b8',lineHeight:20,marginTop:5},detail:{color:'#cbd5e1',lineHeight:20,marginTop:12},buttonText:{color:'white',fontWeight:'800'},section:{borderTopWidth:1,borderTopColor:'#1e293b',marginTop:22,paddingTop:6},forget:{backgroundColor:'#7f1d1d',padding:15,borderRadius:13,marginTop:14},back:{color:'#60a5fa',textAlign:'center',marginTop:24}});
