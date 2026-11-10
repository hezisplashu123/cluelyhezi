Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class CaptureWindows {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr param);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr param);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);
  public sealed class Entry { public string handle, title, executable; public uint pid; public bool minimized, foreground; public int x, y, width, height; }
  public static List<Entry> List() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
    var result = new List<Entry>(); var foreground = GetForegroundWindow();
    EnumWindows((hwnd, unused) => {
      if (!IsWindowVisible(hwnd)) return true;
      int cloaked = 0; try { DwmGetWindowAttribute(hwnd, 14, out cloaked, 4); } catch { }
      if (cloaked != 0) return true;
      RECT r; if (!GetWindowRect(hwnd, out r) || r.right <= r.left || r.bottom <= r.top) return true;
      uint pid; GetWindowThreadProcessId(hwnd, out pid);
      string exe = ""; try { exe = Process.GetProcessById((int)pid).ProcessName + ".exe"; } catch { }
      var text = new StringBuilder(1024); GetWindowText(hwnd, text, text.Capacity);
      result.Add(new Entry { handle = hwnd.ToInt64().ToString(), title = text.ToString(), executable = exe,
        pid = pid, minimized = IsIconic(hwnd), foreground = hwnd == foreground,
        x = r.left, y = r.top, width = r.right-r.left, height = r.bottom-r.top });
      return true;
    }, IntPtr.Zero);
    return result;
  }
}
'@
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
ConvertTo-Json -InputObject @([CaptureWindows]::List()) -Depth 4 -Compress
