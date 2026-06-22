' Sharime.vbs — double-click launcher. Runs the PowerShell starter fully hidden
' (no flashing console), which boots the server and opens the app window.
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = base & "\start-sharime.ps1"
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """", 0, False
