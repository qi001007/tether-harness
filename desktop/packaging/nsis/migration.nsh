!ifndef BUILD_UNINSTALLER
!include LogicLib.nsh
!include FileFunc.nsh
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

Function PrepareUpgradeTemp
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  StrCpy $2 ""

  ; New installations do not need the old-uninstaller short-path workaround.
  ${IfNot} ${FileExists} "$INSTDIR\resources\app.asar"
    Goto prepare_upgrade_temp_done
  ${EndIf}

  ${GetRoot} "$INSTDIR" $0
  ${If} $0 == ""
    Goto prepare_upgrade_temp_failed
  ${EndIf}
  StrCpy $1 "$0\tether-up"
  CreateDirectory "$1"
  ${IfNot} ${FileExists} "$1"
    Goto prepare_upgrade_temp_failed
  ${EndIf}

  ClearErrors
  GetTempFileName $2 "$1"
  IfErrors prepare_upgrade_temp_failed
  FileOpen $3 "$2" w
  IfErrors prepare_upgrade_temp_failed
  FileClose $3
  ClearErrors
  Delete "$2"
  IfErrors prepare_upgrade_temp_failed

  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("TEMP", "$1").r4'
  ${If} $4 == 0
    Goto prepare_upgrade_temp_failed
  ${EndIf}
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("TMP", "$1").r4'
  ${If} $4 == 0
    Goto prepare_upgrade_temp_failed
  ${EndIf}
  Goto prepare_upgrade_temp_done

prepare_upgrade_temp_failed:
  ${If} $2 != ""
    Delete "$2"
  ${EndIf}
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
  MessageBox MB_ICONSTOP|MB_OK "Tether could not prepare a writable short temporary directory on the installation drive. The previous installation was not uninstalled. Check that the drive is writable, then retry."
  SetErrorLevel 1
  Quit

prepare_upgrade_temp_done:
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd
!macro customInit
  Call PrepareUpgradeTemp
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
