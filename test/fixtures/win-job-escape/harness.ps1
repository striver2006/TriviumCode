# ISSUE-08 repro fixture: a KILL_ON_JOB_CLOSE job + a suspended-then-assigned parent process
# (emulating the agy tool channel). ASCII only on purpose: PowerShell 5.1 reads BOM-less .ps1
# files as ANSI on Chinese Windows, and mis-decoded bytes would corrupt the inline C# source
# (same class of pitfall as the GBK batch comments recorded in init.ts).
#
# Usage: harness.ps1 -ParentJs <parent.js> -PidFile <worker pid output> -OutFile <result>
#   The parent script picks the spawn mode itself (written by the test):
#     direct = spawnDetached direct spawn (pre-fix shape): worker MUST die with the job
#     escape = spawnDetached WMI relay (fixed shape):      worker MUST survive job close
#
# All P/Invoke must be inline C#: marshalling ref structs straight from PowerShell silently
# drops SetInformationJobObject flags (measured on win32: returns True, reads back 0x0).
param([string]$ParentJs, [string]$PidFile, [string]$OutFile)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class JobEscapeHarness {
  [StructLayout(LayoutKind.Sequential)]
  public struct BL { public long A; public long B; public uint LimitFlags; public UIntPtr C; public UIntPtr D; public uint E; public UIntPtr F; public uint G; public uint H; }
  [StructLayout(LayoutKind.Sequential)]
  public struct IOC { public ulong R1; public ulong W1; public ulong O1; public ulong R2; public ulong W2; public ulong O2; }
  [StructLayout(LayoutKind.Sequential)]
  public struct JI { public BL B; public IOC I; public UIntPtr P1; public UIntPtr P2; public UIntPtr P3; public UIntPtr P4; }
  [StructLayout(LayoutKind.Sequential)]
  struct SI {
    public uint cb; public IntPtr r1; public IntPtr r2; public IntPtr r3; public IntPtr hIn;
    public IntPtr hOut; public IntPtr hErr; public uint dwFlags; public short s1; public short s2; public short s3; public short s4;
    public IntPtr r4; public IntPtr r5; public IntPtr r6; public IntPtr r7;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct PI { public IntPtr hProcess; public IntPtr hThread; public uint dwProcessId; public uint dwThreadId; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr j, int c, ref JI i, int cb);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr p, IntPtr j, out bool inJob);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint a, bool inh, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern bool CreateProcessW(string app, string cmd, IntPtr sa, IntPtr ta, bool inh, uint flags, IntPtr env, string cwd, ref SI si, out PI pi);
  [DllImport("kernel32.dll")] static extern int ResumeThread(IntPtr t);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  static JI Mk(uint flags) { JI i = new JI(); i.B.LimitFlags = flags; return i; }
  const uint CREATE_SUSPENDED = 0x4;
  const uint CREATE_NO_WINDOW = 0x08000000;

  // Create kill-on-close job -> spawn parent suspended -> assign -> resume -> wait for parent
  // exit -> read PidFile -> close the job (= tool channel end) -> wait -> write OutFile.
  public static string Run(string parentJs, string pidFile, string outFile) {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Exception("CreateJobObject failed");
    JI fl = Mk(0x2000);
    if (!SetInformationJobObject(job, 9, ref fl, Marshal.SizeOf(typeof(JI)))) throw new Exception("SetInformation(KILL_ON_JOB_CLOSE) failed " + Marshal.GetLastWin32Error());
    SI si = new SI(); si.cb = (uint)Marshal.SizeOf(typeof(SI));
    PI pi;
    string cmdl = "\"node.exe\" \"" + parentJs + "\"";
    string cwd = System.IO.Path.GetDirectoryName(parentJs);
    if (!CreateProcessW(null, cmdl, IntPtr.Zero, IntPtr.Zero, false, CREATE_SUSPENDED | CREATE_NO_WINDOW, IntPtr.Zero, cwd, ref si, out pi))
      throw new Exception("CreateProcessW failed " + Marshal.GetLastWin32Error());
    bool assigned = AssignProcessToJobObject(job, pi.hProcess);
    ResumeThread(pi.hThread);
    WaitForSingleObject(pi.hProcess, 60000);
    CloseHandle(pi.hThread); CloseHandle(pi.hProcess);
    string pidText = null;
    for (int i = 0; i < 400; i++) {
      if (System.IO.File.Exists(pidFile)) { pidText = System.IO.File.ReadAllText(pidFile).Trim(); if (pidText.Length > 0) break; }
      System.Threading.Thread.Sleep(100);
    }
    if (string.IsNullOrEmpty(pidText)) {
      System.IO.File.WriteAllText(outFile, "ERROR=no_worker_pid assigned=" + assigned);
      return "NO_PID";
    }
    int workerPid = int.Parse(pidText);
    System.Threading.Thread.Sleep(600);
    string before = Check(workerPid);
    CloseHandle(job);
    System.Threading.Thread.Sleep(2500);
    string after = Check(workerPid);
    System.IO.File.WriteAllText(outFile, "assigned=" + assigned + " pid=" + workerPid + " before=" + before + " after=" + after);
    return "OK";
  }
  static string Check(int pid) {
    IntPtr h = OpenProcess(0x1000, false, pid);
    if (h == IntPtr.Zero) return "GONE";
    bool inAny = false;
    IsProcessInJob(h, IntPtr.Zero, out inAny);
    CloseHandle(h);
    return inAny ? "ALIVE_IN_JOB" : "ALIVE_NO_JOB";
  }
}
"@
[void][JobEscapeHarness]::Run($ParentJs, $PidFile, $OutFile)
