import { StyleSheet, Text, View } from 'react-native';
export function StatusHeader({ connected, status, monitor }: { connected: boolean; status: string; monitor?: number | null }) {
  return <View style={s.row}><View><Text style={s.title}>OpenCluely</Text><Text style={s.sub}>Monitor {monitor ?? '—'} · {status}</Text></View><View style={s.connection}><View style={[s.dot, { backgroundColor: connected ? '#4ade80' : '#64748b' }]} /><Text style={s.label}>{connected ? 'Connected' : 'Offline'}</Text></View></View>;
}
const s = StyleSheet.create({ row:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',padding:18,paddingTop:8},title:{color:'#f8fafc',fontSize:24,fontWeight:'800'},sub:{color:'#94a3b8',marginTop:3},connection:{alignItems:'center',gap:4},dot:{width:10,height:10,borderRadius:5},label:{color:'#94a3b8',fontSize:11} });
