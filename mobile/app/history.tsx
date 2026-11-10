import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text } from 'react-native';
import { api } from '../src/services/api';
import { loadConnection } from '../src/services/connection';
export default function History(){const router=useRouter();const [items,setItems]=useState<any[]>([]);useEffect(()=>{loadConnection().then(c=>c&&api.conversations(c).then(r=>setItems(r.items)));},[]);return <SafeAreaView style={s.page}><Text style={s.title}>Conversations</Text><FlatList data={items} keyExtractor={i=>i.id} renderItem={({item})=><Pressable style={s.row} onPress={()=>router.push({pathname:'/conversation',params:{id:item.id,title:item.title||'Conversation'}})}><Text style={s.name}>{item.title||'Conversation'}</Text><Text style={s.date}>{new Date(item.updatedAt).toLocaleString()}</Text></Pressable>}/><Pressable onPress={()=>router.back()}><Text style={s.back}>Back</Text></Pressable></SafeAreaView>}
const s=StyleSheet.create({page:{flex:1,backgroundColor:'#080b12',padding:18},title:{color:'white',fontSize:28,fontWeight:'800',marginBottom:14},row:{backgroundColor:'#111827',borderColor:'#283447',borderWidth:1,borderRadius:14,padding:15,marginBottom:8},name:{color:'#e2e8f0',fontWeight:'700'},date:{color:'#64748b',marginTop:5},back:{color:'#60a5fa',textAlign:'center',padding:18}});
