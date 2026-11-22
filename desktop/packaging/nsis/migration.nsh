!ifndef BUILD_UNINSTALLER
!include LogicLib.nsh
!include FileFunc.nsh
Var TetherLegacyInstallRoot
Var TetherLegacyCanonicalRoot
Function PreserveTetherLegacyData
  nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\preserve-legacy-data.ps1" -InstallRoot "$INSTDIR" -LegacyInstallRoot "$TetherLegacyInstallRoot" -LegacyCanonicalRoot "$TetherLegacyCanonicalRoot"'
  Pop $0
  Pop $1
  StrCmp $0 0 migration_preserved
  StrCmp $0 20 migration_workspace_preserved
  StrCmp $0 21 migration_workspace_failed
    MessageBox MB_ICONSTOP|MB_OK "Tether could not safely preserve the previous device identity. Close the previous Tether APP and its managed Node, then retry installation."
    SetErrorLevel 1
    Quit
  migration_workspace_preserved:
    MessageBox MB_ICONSTOP|MB_OK "Tether could not merge the previous workspace with the selected profile. The complete workspace copy is at:$\r$\n$1$\r$\nResolve the folder conflict, then retry. The old installation has not been uninstalled." /SD IDOK
    SetErrorLevel 20
    Quit
  migration_workspace_failed:
    MessageBox MB_ICONSTOP|MB_OK "Tether could not copy the previous workspace safely. Close the previous APP and check the workspace and available disk space, then retry. The old installation has not been uninstalled." /SD IDOK
    SetErrorLevel 21
    Quit
  migration_preserved:
FunctionEnd

; Stack input and output are the selected installation path. Only an existing
; Tether installation needs resolution, and its handle follows junctions.
Function ResolveTetherInstallRoot
  Exch $0
  Push $1
  Push $2
  ${If} ${FileExists} "$0\resources\app.asar"
    System::Call 'kernel32::CreateFileW(w r0, i 0, i 7, p 0, i 3, i 0x02000000, p 0)p.r1'
    ${If} $1 == -1
      Goto resolve_tether_root_failed
    ${EndIf}
    System::Call 'kernel32::GetFinalPathNameByHandleW(p r1, w .r0, i ${NSIS_MAX_STRLEN}, i 0)i.r2'
    System::Call 'kernel32::CloseHandle(p r1)'
    ${If} $2 <= 0
    ${OrIf} $2 >= ${NSIS_MAX_STRLEN}
      Goto resolve_tether_root_failed
    ${EndIf}
    StrCpy $2 $0 4
    ${If} $2 != "\\?\"
      Goto resolve_tether_root_failed
    ${EndIf}
    StrCpy $0 $0 "" 4
    ${GetRoot} "$0" $2
    StrLen $2 $2
    ${If} $2 != 2
      Goto resolve_tether_root_failed
    ${EndIf}
  ${EndIf}
  Pop $2
  Pop $1
  Exch $0
  Return

resolve_tether_root_failed:
  MessageBox MB_ICONSTOP|MB_OK "Tether could not resolve the previous installation folder. Check that the installation drive is available, then retry." /SD IDOK
  SetErrorLevel 1
  Quit
FunctionEnd

; Both electron-builder's uninstallOldVersion and legacy un.onInit read this
; key. Keep the old uninstall executable reachable via the original junction;
; only change where it operates. The builder writes the final registration.
!macro TetherCanonicalizeRegistration ROOT_KEY SELECT_ROOT PERSIST_ROOT
  Push $0
  Push $1
  ReadRegStr $0 ${ROOT_KEY} "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 != ""
    !if ${SELECT_ROOT} == 1
      ${If} ${isUpdated}
      ${AndIfNot} ${FileExists} "$0\resources\app.asar"
        MessageBox MB_ICONSTOP|MB_OK "The previous Tether installation folder is unavailable. Reconnect its drive, then retry the update." /SD IDOK
        SetErrorLevel 1
        Quit
      ${EndIf}
    !endif
    Push $0
    Call ResolveTetherInstallRoot
    Pop $1
    !if ${SELECT_ROOT} == 1
      ${If} ${FileExists} "$0\resources\app.asar"
        ${IfNot} ${Silent}
        ${AndIf} $INSTDIR != $0
        ${AndIf} $INSTDIR != $1
          MessageBox MB_ICONINFORMATION|MB_OK "Tether is already installed in $1. The existing installation will be updated there." /SD IDOK
        ${EndIf}
        ${If} $0 != $1
          StrCpy $TetherLegacyInstallRoot $0
          StrCpy $TetherLegacyCanonicalRoot $1
        ${EndIf}
        StrCpy $INSTDIR $1
      ${EndIf}
    !endif
    !if ${PERSIST_ROOT} == 1
      ${If} $0 != $1
        ClearErrors
        WriteRegStr ${ROOT_KEY} "${INSTALL_REGISTRY_KEY}" InstallLocation "$1"
        ${If} ${Errors}
          MessageBox MB_ICONSTOP|MB_OK "Tether could not update the previous installation path. Run the installer with the permissions used for the previous installation." /SD IDOK
          SetErrorLevel 1
          Quit
        ${EndIf}
      ${EndIf}
    !endif
  ${EndIf}
  Pop $1
  Pop $0
!macroend

!macro TetherPrepareUpgrade
  !insertmacro TetherCanonicalizeRegistration SHELL_CONTEXT 1 1
  ${If} $installMode == "all"
    !insertmacro TetherCanonicalizeRegistration HKCU 0 1
  ${EndIf}
  Push $INSTDIR
  Call ResolveTetherInstallRoot
  Pop $INSTDIR
  Call ValidateTetherInstallRoot
  Call PrepareUpgradeTemp
  Call PreserveTetherLegacyData
!macroend

Function ValidateTetherInstallRoot
  Push $0
  Push $1
  Push $2
  StrCpy $2 "0"

validate_tether_root:
  ${If} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
  ${AndIf} ${FileExists} "$INSTDIR\resources\app.asar"
    Goto validate_tether_root_done
  ${EndIf}
  ${GetRoot} "$INSTDIR" $0
  StrCmp $INSTDIR "$0\" validate_tether_root_nonempty
  ClearErrors
  FindFirst $0 $1 "$INSTDIR\*.*"
  IfErrors validate_tether_root_done
  ${DoWhile} $1 != ""
    ${If} $1 != "."
    ${AndIf} $1 != ".."
      FindClose $0
      Goto validate_tether_root_nonempty
    ${EndIf}
    FindNext $0 $1
  ${Loop}
  FindClose $0
  Goto validate_tether_root_done

validate_tether_root_nonempty:
  ${If} $2 == "0"
    MessageBox MB_ICONEXCLAMATION|MB_OKCANCEL "The selected folder contains other files. Choose OK to install in its ${APP_FILENAME} subfolder, or Cancel to stop and select another folder." /SD IDCANCEL IDOK validate_tether_root_subfolder
  ${Else}
    MessageBox MB_ICONSTOP|MB_OK "The suggested folder also contains other files. Restart the installer and choose an empty or new folder." /SD IDOK
  ${EndIf}
  SetErrorLevel 1
  Quit

validate_tether_root_subfolder:
  StrCpy $2 "1"
  StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
  Goto validate_tether_root

validate_tether_root_done:
  Pop $2
  Pop $1
  Pop $0
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
  StrLen $4 $0
  ${If} $4 != 2
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
  MessageBox MB_ICONSTOP|MB_OK "Tether could not prepare a writable short temporary directory on the installation drive. The previous installation was not uninstalled. Check that the drive is writable, then retry." /SD IDOK
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
  !insertmacro TetherCanonicalizeRegistration SHELL_CONTEXT 1 0
  Call PrepareUpgradeTemp
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File /oname=preserve-legacy-data.ps1 "${PROJECT_DIR}\desktop\packaging\nsis\preserve-legacy-data.ps1"
  ${if} ${Silent}
    ; Assisted per-machine silent install elevates after .onInit. Its elevated
    ; instance runs this hook again before the old uninstaller is invoked.
    ${If} $installMode != "all"
    ${OrIf} ${UAC_IsAdmin}
      !insertmacro TetherPrepareUpgrade
    ${EndIf}
  ${endIf}
!macroend

!macro customPageAfterChangeDir
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !define MUI_PAGE_CUSTOMFUNCTION_PRE tetherMigrationInstallFilesPre
  Function tetherMigrationInstallFilesPre
    !insertmacro TetherPrepareUpgrade
  FunctionEnd
!macroend
!endif
