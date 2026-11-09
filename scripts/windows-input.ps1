# Host screen controls and click-through wheel routing; grabbed VMs need a release chord.
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
public class OverlayInput {
  delegate IntPtr Hook(int n, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] struct Point { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] struct Mouse { public Point p; public uint data, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct Key { public uint vk, scan, flags, time; public UIntPtr extra; }
  class Panel { public string name; public int x,y,w,h; }
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, Hook callback, IntPtr module, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int n, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("kernel32.dll", CharSet=CharSet.Auto)] static extern IntPtr GetModuleHandle(string module);
  static Hook keyboard = Keyboard, mouse = Pointer;
  static IntPtr kh, mh;
  static volatile Panel[] panels = new Panel[0];
  static volatile string scrollThrough = "";
  static HashSet<uint> held = new HashSet<uint>();
  static bool manualRelease;
  static bool Down(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
  static void Emit(string value) { Console.WriteLine(value); Console.Out.Flush(); }
  static IntPtr Keyboard(int n, IntPtr w, IntPtr l) {
    if (n < 0) return CallNextHookEx(kh,n,w,l);
    Key key = (Key)Marshal.PtrToStructure(l, typeof(Key));
    bool up = w.ToInt32() == 0x101 || w.ToInt32() == 0x105;
    if (up) { if (held.Remove(key.vk)) return (IntPtr)1; return CallNextHookEx(kh,n,w,l); }
    bool ctrl = Down(0x11), shift = Down(0x10), alt = Down(0x12);
    string action = null;
    if (!ctrl && !shift && !alt) {
      if (key.vk == 0xDC || key.vk == 0xE2 || (key.vk == 0xE7 && key.scan == 92)) action = "capture";
      if (key.vk == 0xC0 || (key.vk == 0xE7 && key.scan == 96)) action = "submit";
    }
    if (ctrl && shift && !alt) {
      if (key.vk == 0x53) action = "capture";
      if (key.vk == 0x0D) action = "submit";
      if (key.vk == 0x49) action = "interact";
      if (key.vk == 0x4F) action = "panels";
    }
    if (action != null) {
      if (held.Add(key.vk)) Emit("key:" + action);
      return (IntPtr)1;
    }
    return CallNextHookEx(kh,n,w,l);
  }
  static IntPtr Pointer(int n, IntPtr w, IntPtr l) {
    if (n >= 0) {
      Mouse m = (Mouse)Marshal.PtrToStructure(l, typeof(Mouse));
      Panel[] current = panels;
      string hovered = "";
      // Last rectangle is topmost if the panels overlap.
      for (int i=current.Length-1; i>=0; i--) {
        Panel p = current[i];
        if (m.p.x >= p.x && m.p.x < p.x+p.w && m.p.y >= p.y && m.p.y < p.y+p.h) {
          hovered = p.name;
          break;
        }
      }
      if (scrollThrough != "" && scrollThrough != hovered) { scrollThrough = ""; Emit("scroll-through:"); }
      if (w.ToInt32() == 0x201 && hovered != "") {
        scrollThrough = hovered;
        Emit("scroll-through:" + hovered);
        // The click itself still reaches the application under the overlay.
      }
      if (hovered != "" && scrollThrough != hovered && (w.ToInt32() == 0x20A || w.ToInt32() == 0x20E)) {
          int delta = (short)(m.data >> 16);
          Emit("wheel:" + hovered + ":" + (w.ToInt32() == 0x20E ? "x:" : "y:") + delta);
          return (IntPtr)1;
      }
    }
    return CallNextHookEx(mh,n,w,l);
  }
  public static void Run() {
    var thread = new Thread(() => {
      string line;
      while ((line = Console.ReadLine()) != null) {
        if (line.StartsWith("bypass|")) { scrollThrough = line.Substring(7); continue; }
        if (!line.StartsWith("panels|")) continue;
        var next = new List<Panel>();
        foreach (string value in line.Substring(7).Split('|')) {
          string[] v = value.Split(',');
          if (v.Length == 5) { try { next.Add(new Panel { name=v[0], x=int.Parse(v[1]), y=int.Parse(v[2]), w=int.Parse(v[3]), h=int.Parse(v[4]) }); } catch {} }
        }
        panels = next.ToArray();
      }
      Environment.Exit(0); // Parent exit closes stdin: do not leave a hook behind.
    });
    thread.IsBackground = true;
    thread.Start();
    IntPtr module = GetModuleHandle(null);
    kh = SetWindowsHookEx(13, keyboard, module, 0);
    mh = SetWindowsHookEx(14, mouse, module, 0);
    if (kh == IntPtr.Zero || mh == IntPtr.Zero) throw new Exception("Cannot install host input hooks: " + Marshal.GetLastWin32Error());
    Emit("ready");
    // Observe only the reserved controls. Never synthesize a key or change VM
    // focus. VMware can leave hook state stale after a manual ungrab; rearm
    // when the user's Ctrl+Alt chord is released and poll for missed key edges.
    var controls = new System.Windows.Forms.Timer();
    controls.Interval = 20;
    controls.Tick += (sender, args) => {
      bool ctrl = Down(0x11), alt = Down(0x12), shift = Down(0x10);
      if (ctrl && alt) manualRelease = true;
      if (manualRelease && !ctrl && !alt) {
        manualRelease = false;
        held.Clear();
        UnhookWindowsHookEx(kh);
        kh = SetWindowsHookEx(13, keyboard, module, 0);
        Emit("manual-release");
      }
      foreach (uint key in new uint[] { 0xDC, 0xE2, 0xC0 }) {
        if (!Down((int)key)) { held.Remove(key); continue; }
        if (!ctrl && !alt && !shift && held.Add(key)) Emit("key:" + (key == 0xC0 ? "submit" : "capture"));
      }
    };
    controls.Start();
    try { Application.Run(); }
    finally { controls.Stop(); UnhookWindowsHookEx(kh); UnhookWindowsHookEx(mh); }
  }
}
'@
[OverlayInput]::Run()
