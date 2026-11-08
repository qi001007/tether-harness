!ifndef BUILD_UNINSTALLER
Function PreserveTetherLegacyData
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\preserve-legacy-data.ps1" -InstallRoot "$INSTDIR"'
  Pop $0
  Pop $1
  StrCmp $0 0 migration_preserved
    MessageBox MB_ICONSTOP|MB_OK "Tether could not safely preserve the previous device identity. Close the previous Tether APP and its managed Node, then retry installation."
    SetErrorLevel 1
    Quit
  migration_preserved:
FunctionEnd

!macro customInit
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=preserve-legacy-data.ps1 "${PROJECT_DIR}\desktop\packaging\nsis\preserve-legacy-data.ps1"
  ${if} ${Silent}
    Call PreserveTetherLegacyData
  ${endIf}
!macroend

!macro customPageAfterChangeDir
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !define MUI_PAGE_CUSTOMFUNCTION_PRE tetherMigrationInstallFilesPre
!macroend

Function tetherMigrationInstallFilesPre
  Call instFilesPre
  Call PreserveTetherLegacyData
FunctionEnd
!endif
