// Windows guest companion: forwards only four reserved controls and panel wheel events.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Drawing;
using System.Reflection;

[assembly: AssemblyTitle("yashpc1")]
[assembly: AssemblyProduct("yashpc1")]
[assembly: AssemblyDescription("VM control keys and click-through panel scrolling")]

class PanelScrollRouting {
  volatile string target = "", bypass = "";
  public void Update(string hovered, string scrollTarget) {
    target = scrollTarget;
    if(bypass!="" && bypass!=hovered) bypass="";
  }
  public bool LeftClick() {
    if(target=="") return false;
    bypass=target;
    return true;
  }
  public bool CaptureWheel { get { return target!="" && bypass!=target; } }
}

class VMControls {
  delegate IntPtr Hook(int n, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] struct Key { public uint vk, scan, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct Point { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] struct Mouse { public Point p; public uint data, flags, time; public UIntPtr extra; }
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int kind, Hook callback, IntPtr module, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int n, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr h);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int k);
  [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
  static Hook keyboard = Keyboard, mouse = Wheel;
  static IntPtr kh, mh;
  static HashSet<uint> held = new HashSet<uint>();
  static ConcurrentQueue<string> queue = new ConcurrentQueue<string>();
  static AutoResetEvent wake = new AutoResetEvent(false);
  static volatile bool connected, running = true;
  static volatile string scrollTarget = "", connectionStatus = "Connecting to host…";
  static PanelScrollRouting scroll = new PanelScrollRouting();
  static string[] hosts;
  static string token, activeHost;
  static bool Down(int k) { return (GetAsyncKeyState(k) & 0x8000) != 0; }
  static void Send(string value) { queue.Enqueue(value); wake.Set(); }
  static IntPtr Keyboard(int n, IntPtr w, IntPtr l) {
    if (n < 0) return CallNextHookEx(kh,n,w,l);
    Key k = (Key)Marshal.PtrToStructure(l,typeof(Key));
    bool up = w.ToInt32()==0x101 || w.ToInt32()==0x105;
    if (up) { if(held.Remove(k.vk)) return (IntPtr)1; return CallNextHookEx(kh,n,w,l); }
    bool ctrl=Down(0x11), shift=Down(0x10), alt=Down(0x12);
    string action=null;
    if (!ctrl && !shift && !alt) { if(k.vk==0xDC) action="capture"; if(k.vk==0xC0) action="submit"; }
    if (ctrl && shift && !alt) {
      if(k.vk==0x53) action="capture"; if(k.vk==0x0D) action="submit";
      if(k.vk==0x49) action="interact"; if(k.vk==0x4F) action="panels";
    }
    if (action!=null && connected) {
      if(held.Add(k.vk)) Send("{\"action\":\"" + action + "\"}");
      return (IntPtr)1;
    }
    return CallNextHookEx(kh,n,w,l);
  }
  static IntPtr Wheel(int n, IntPtr w, IntPtr l) {
    if(n>=0 && connected && w.ToInt32()==0x201 && scroll.LeftClick()) {
      Send("{\"action\":\"scroll-through\"}");
      // Do not swallow the click: the guest application needs it for focus.
    }
    if(n>=0 && connected && scroll.CaptureWheel && (w.ToInt32()==0x20A || w.ToInt32()==0x20E)) {
      Mouse m=(Mouse)Marshal.PtrToStructure(l,typeof(Mouse));
      int delta=(short)(m.data>>16);
      int x=w.ToInt32()==0x20E ? delta*90/120 : 0;
      int y=w.ToInt32()==0x20A ? -delta*90/120 : 0;
      Send("{\"action\":\"scroll\",\"x\":" + x + ",\"y\":" + y + "}");
      return (IntPtr)1;
    }
    return CallNextHookEx(mh,n,w,l);
  }
  static string Request(string host, string route, string body) {
    var req=(HttpWebRequest)WebRequest.Create(host+route);
    req.Proxy=null; req.Timeout=1200; req.ReadWriteTimeout=1200;
    req.Headers["Authorization"]="Bearer "+token;
    if(body!=null) {
      req.Method="POST"; req.ContentType="application/json";
      byte[] bytes=System.Text.Encoding.UTF8.GetBytes(body); req.ContentLength=bytes.Length;
      using(var stream=req.GetRequestStream()) stream.Write(bytes,0,bytes.Length);
    }
    using(var response=req.GetResponse()) using(var reader=new StreamReader(response.GetResponseStream())) return reader.ReadToEnd();
  }
  static void Network() {
    var json=new JavaScriptSerializer();
    while(running) {
      try {
        if(activeHost==null) {
          foreach(string host in hosts) { try { Request(host,"/state",null); activeHost=host; break; } catch {} }
          if(activeHost==null) throw new Exception("Host is unreachable. Keep OpenCluely running on the host.");
        }
        string command;
        while(queue.TryDequeue(out command)) Request(activeHost,"/control",command);
        var state=json.Deserialize<Dictionary<string,object>>(Request(activeHost,"/state",null));
        scrollTarget=Convert.ToString(state["scrollTarget"]);
        scroll.Update(state.ContainsKey("hoveredPanel") ? Convert.ToString(state["hoveredPanel"]) : scrollTarget, scrollTarget);
        connected=true;
        connectionStatus="Connected · \\ capture · ` answer · Ctrl+Shift+I move/copy";
      } catch {
        connected=false; scrollTarget=""; activeHost=null;
        scroll.Update("", "");
        connectionStatus="Not connected. Keep the host app running; check the VM network.";
      }
      wake.WaitOne(connected ? 90 : 1500);
    }
  }
  [STAThread] static void Main(string[] args) {
    if(args.Length>0 && args[0]=="--self-test") {
      var routing=new PanelScrollRouting();
      routing.Update("codeResponse","codeResponse");
      if(!routing.CaptureWheel) throw new Exception("Hover must scroll the panel.");
      if(!routing.LeftClick() || routing.CaptureWheel) throw new Exception("Click must send scrolling behind the panel.");
      routing.Update("codeResponse","codeResponse");
      if(routing.CaptureWheel) throw new Exception("A stale host poll must not undo the click.");
      routing.Update("codeResponse","");
      if(routing.CaptureWheel) throw new Exception("Scroll-through must persist while hovering.");
      routing.Update("", "");
      routing.Update("codeResponse","codeResponse");
      if(!routing.CaptureWheel) throw new Exception("Leaving and reentering must restore panel scrolling.");
      routing.LeftClick(); routing.Update("llmResponse","llmResponse");
      if(!routing.CaptureWheel) throw new Exception("Moving to the other panel must restore scrolling.");
      Console.WriteLine("yashpc1 scroll checks passed: hover, click-through, stale polls, leaving/reentering, and switching panels.");
      return;
    }
    bool check=args.Length>0 && args[0]=="--check";
    bool created;
    using(var single=new Mutex(true,"Local\\OpenCluelyVMControls",out created)) {
      if(!created) { MessageBox.Show("The VM helper is already running. Exit the old helper or yashpc1 from its tray icon first.", "yashpc1"); return; }
      Application.EnableVisualStyles();
      try {
        var config=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"vm-controls.json")));
        var values=(System.Collections.ArrayList)config["hosts"];
        hosts=new string[values.Count]; for(int i=0;i<values.Count;i++) hosts[i]=Convert.ToString(values[i]);
        token=Convert.ToString(config["token"]);
        if(hosts.Length==0) throw new Exception("No VMware network adapter was found on the host.");
      } catch(Exception error) { if(check) { Console.Error.WriteLine(error.Message); Environment.ExitCode=1; return; } MessageBox.Show("Keep vm-controls.json beside yashpc1.exe.\n\n"+error.Message,"yashpc1"); return; }
      if(check) {
        foreach(string host in hosts) { try { Request(host,"/state",null); Console.WriteLine("Guest helper configuration and host connection verified."); return; } catch {} }
        Console.Error.WriteLine("No configured host listener could be reached."); Environment.ExitCode=1; return;
      }
      IntPtr module=GetModuleHandle(null);
      kh=SetWindowsHookEx(13,keyboard,module,0); mh=SetWindowsHookEx(14,mouse,module,0);
      if(kh==IntPtr.Zero || mh==IntPtr.Zero) { MessageBox.Show("Could not start guest input controls."); return; }
      var worker=new Thread(Network); worker.IsBackground=true; worker.Start();
      var form=new Form { Text="yashpc1", Width=560, Height=300, StartPosition=FormStartPosition.CenterScreen, MaximizeBox=false };
      var label=new Label { Dock=DockStyle.Fill, Padding=new Padding(18), Font=new Font("Segoe UI",11), Text="Connecting…" };
      form.Controls.Add(label);
      var tray=new NotifyIcon { Icon=SystemIcons.Application, Text="yashpc1", Visible=true };
      var menu=new ContextMenuStrip(); menu.Items.Add("Show controls",null,(s,e)=> { form.Show(); form.Activate(); }); menu.Items.Add("Exit",null,(s,e)=>Application.Exit()); tray.ContextMenuStrip=menu;
      tray.DoubleClick+=(s,e)=> { form.Show(); form.Activate(); };
      form.FormClosing+=(s,e)=> { if(e.CloseReason==CloseReason.UserClosing) { e.Cancel=true; form.Hide(); } };
      var timer=new System.Windows.Forms.Timer { Interval=400 };
      timer.Tick+=(s,e)=> { label.Text=connectionStatus+"\n\nHover + wheel: scroll the answer panel.\nLeft-click + wheel: scroll the VM behind it.\nMove off and back: scroll the answer panel again.\n\nClose this window to leave yashpc1 running in the tray."; tray.Text=connected ? "yashpc1 - Connected" : "yashpc1 - Not connected"; };
      timer.Start();
      try { Application.Run(form); }
      finally { running=false; wake.Set(); timer.Stop(); tray.Dispose(); UnhookWindowsHookEx(kh); UnhookWindowsHookEx(mh); }
    }
  }
}
