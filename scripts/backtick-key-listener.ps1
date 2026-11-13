$source = @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class OpenCluelyBacktickHook {
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const int VK_OEM_3 = 0xC0;
    private static IntPtr hook = IntPtr.Zero;
    private static bool isDown;
    private static HookProc callback = HandleKeyboard;

    public static void Run() {
        using (Process process = Process.GetCurrentProcess())
        using (ProcessModule module = process.MainModule) {
            hook = SetWindowsHookEx(WH_KEYBOARD_LL, callback, GetModuleHandle(module.ModuleName), 0);
        }
        if (hook == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        AppDomain.CurrentDomain.ProcessExit += delegate { Release(); };
        MSG message;
        while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) {
            TranslateMessage(ref message);
            DispatchMessage(ref message);
        }
        Release();
    }

    private static IntPtr HandleKeyboard(int code, IntPtr message, IntPtr data) {
        if (code >= 0) {
            int vkCode = Marshal.ReadInt32(data);
            int kind = message.ToInt32();
            if (vkCode == VK_OEM_3) {
                if ((kind == WM_KEYDOWN || kind == WM_SYSKEYDOWN) && !isDown) {
                    isDown = true;
                    Console.Out.WriteLine("DOWN");
                    Console.Out.Flush();
                } else if ((kind == WM_KEYUP || kind == WM_SYSKEYUP) && isDown) {
                    isDown = false;
                    Console.Out.WriteLine("UP");
                    Console.Out.Flush();
                }
            }
        }
        return CallNextHookEx(hook, code, message, data);
    }

    private static void Release() {
        if (hook != IntPtr.Zero) {
            UnhookWindowsHookEx(hook);
            hook = IntPtr.Zero;
        }
    }

    private delegate IntPtr HookProc(int code, IntPtr message, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int x; public int y; }
    [StructLayout(LayoutKind.Sequential)] private struct MSG { public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int id, HookProc callback, IntPtr module, uint threadId);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)] private static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] private static extern sbyte GetMessage(out MSG message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")] private static extern bool TranslateMessage(ref MSG message);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref MSG message);
}
'@

Add-Type -TypeDefinition $source
[OpenCluelyBacktickHook]::Run()
