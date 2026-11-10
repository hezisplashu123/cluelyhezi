# Mouse-wheel routing for click-through answer panels. No keyboard hooks.
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
public class OverlayMouseRouting {
  delegate IntPtr Hook(int n, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] struct Point { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] struct Mouse { public Point p; public uint data, flags, time; public UIntPtr extra; }
  class Panel { public string name; public int x,y,w,h; }
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Hook callback, IntPtr module, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int n, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("kernel32.dll", CharSet=CharSet.Auto)] static extern IntPtr GetModuleHandle(string module);
  static Hook mouse = Pointer; static IntPtr mh; static volatile Panel[] panels = new Panel[0]; static volatile string pressedPanel = "";
  static void Emit(string value) { Console.WriteLine(value); Console.Out.Flush(); }
  static IntPtr Pointer(int n, IntPtr w, IntPtr l) {
    if (n >= 0) {
      Mouse m = (Mouse)Marshal.PtrToStructure(l, typeof(Mouse)); string hovered = "";
      for (int i=panels.Length-1; i>=0; i--) { Panel p=panels[i]; if(m.p.x>=p.x&&m.p.x<p.x+p.w&&m.p.y>=p.y&&m.p.y<p.y+p.h){hovered=p.name;break;} }
      // Hold the left button over a panel to route the wheel into that panel.
      // Releasing immediately restores normal click-through/wheel behavior for
      // the application behind the overlay.
      if (w.ToInt32()==0x201 && hovered!="") { pressedPanel=hovered; return (IntPtr)1; }
      if (w.ToInt32()==0x202 && pressedPanel!="") { pressedPanel=""; return (IntPtr)1; }
      if (hovered!="" && pressedPanel==hovered && (w.ToInt32()==0x20A||w.ToInt32()==0x20E)) { int delta=(short)(m.data>>16); Emit("wheel:"+hovered+":"+(w.ToInt32()==0x20E?"x:":"y:")+delta); return (IntPtr)1; }
    }
    return CallNextHookEx(mh,n,w,l);
  }
  public static void Run() {
    var thread=new Thread(()=>{ string line; while((line=Console.ReadLine())!=null){ if(!line.StartsWith("panels|"))continue; var next=new List<Panel>(); foreach(string value in line.Substring(7).Split('|')){string[] v=value.Split(',');if(v.Length==5){try{next.Add(new Panel{name=v[0],x=int.Parse(v[1]),y=int.Parse(v[2]),w=int.Parse(v[3]),h=int.Parse(v[4])});}catch{}}}panels=next.ToArray();} Environment.Exit(0);});
    thread.IsBackground=true;thread.Start(); mh=SetWindowsHookEx(14,mouse,GetModuleHandle(null),0); if(mh==IntPtr.Zero)throw new Exception("Cannot install mouse hook: "+Marshal.GetLastWin32Error()); Emit("ready"); try{Application.Run();}finally{UnhookWindowsHookEx(mh);}
  }
}
'@
[OverlayMouseRouting]::Run()
