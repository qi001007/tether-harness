' Launch Tether without a console window. The .cmd keeps the bootstrap logic;
' this script only hides its window so the APP starts like a normal GUI app.
Option Explicit
Dim shell, fso, dir, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = "cmd.exe /c """"" & dir & "\Tether-App.cmd"""""
shell.Run cmd, 0, False
