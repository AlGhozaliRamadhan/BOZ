; BOZ NSIS installer hooks.
;
; Wired in by `bundle.windows.nsis.installerHooks` and included by
; `src-tauri/nsis/installer.nsi`.
;
; Why this exists
; ---------------
; BOZ is not only `boz-desktop.exe`: it also supervises a bundled Node.js
; sidecar at `$INSTDIR\resources\node.exe`. The stock Tauri check only closes
; `${MAINBINARYNAME}.exe`, so the sidecar stayed alive and kept its own image
; mapped. The installer then failed with
;
;   Error opening file for writing:
;   C:\Users\<user>\AppData\Local\BOZ\resources\node.exe
;
; Closing BOZ first (so it cannot respawn the sidecar), then any sidecar that
; outlived it, and waiting for the file handle to be released keeps the update
; from ever reaching that dialog.
;
; Registers used here ($0..$3) are scratch only; `$INSTDIR` and friends are
; untouched.

; 1 when this run had to close a BOZ that was running, so the installer can
; start it again afterwards. Read by `installer.nsi` in `.onInstSuccess`.
Var BozClosedRunningApp
; 1 when `installer.nsi` recognised this run as an update of an installed copy
; (setup started by hand) instead of a first install or an in-app update.
Var BozUpdateRun
; 1 when the installation page is the progress-only update page (in-app update
; or a hand-started update). Declared here because `Var PassiveMode` appears
; after this include in `installer.nsi`.
Var BozUpdateUi

; The installation page in passive/update mode: keep the single progress page,
; but label it as the update it is instead of the generic installer page.
; Called through `MUI_PAGE_CUSTOMFUNCTION_SHOW` in `installer.nsi`.
Function BozInstFilesShow
  ${If} $BozUpdateUi = 1
    !insertmacro MUI_HEADER_TEXT "Updating BOZ" "Replacing the previous version. BOZ starts again when this finishes."
    System::Call 'user32::SetWindowTextW(p $HWNDPARENT, w "BOZ Update")'
  ${EndIf}
FunctionEnd

; Path of a 64-bit Windows PowerShell in `${BozPs}`.
;
; `$SYSDIR` is redirected to SysWOW64 because the installer is a 32-bit
; process, and 32-bit PowerShell cannot read the image path of a 64-bit
; process: `Get-Process ... .Path` comes back empty there, so the sidecar
; filter matched nothing and the kill silently did nothing. Sysnative is the
; 64-bit view and exists exactly when the installer runs as a 32-bit process on
; a 64-bit system.
!macro BozFindPowerShell BozPs
  StrCpy ${BozPs} "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  ${If} ${FileExists} "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    StrCpy ${BozPs} "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
!macroend

; Close BOZ and the Node.js sidecar it supervises.
;
; Sidecar processes are scoped by executable path inside this installation:
; other Node.js processes on the machine are none of our business and are never
; touched. `$$` is NSIS's escape for a literal `$`, so `$$_` reaches PowerShell
; as `$_`.
!macro BozCloseApp
  StrCpy $BozClosedRunningApp 0

  ; Close BOZ first: a live app would only restart the sidecar we stop next.
  ; `taskkill` exits with 128 when no process matched, so $0 doubles as the
  ; "was the user running BOZ?" answer. /T takes the child processes with it.
  nsExec::ExecToStack '"$SYSDIR\taskkill.exe" /F /T /IM "${MAINBINARYNAME}.exe"'
  Pop $0
  Pop $1
  ${If} $0 = 0
    StrCpy $BozClosedRunningApp 1
    DetailPrint "Closed the running ${PRODUCTNAME} process tree."
    Sleep 400
  ${EndIf}

  ; Stop a sidecar that outlived BOZ (crash, forced shutdown, a previous
  ; install that finished while the old sidecar was still serving).
  ${If} ${FileExists} "$INSTDIR\resources\node.exe"
    !insertmacro BozFindPowerShell $2
    System::Call 'kernel32::SetEnvironmentVariableW(w "BOZ_INSTALL_ROOT", w "$INSTDIR") i.r0'
    nsExec::ExecToStack '"$2" -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { try { [System.IO.Path]::GetFullPath($$_.Path).StartsWith($$env:BOZ_INSTALL_ROOT, [System.StringComparison]::OrdinalIgnoreCase) } catch { $$false } } | Stop-Process -Force -ErrorAction SilentlyContinue"'
    Pop $0
    Pop $1
    ${If} $0 = 0
      DetailPrint "Stopped the ${PRODUCTNAME} Node.js sidecar."
    ${EndIf}
  ${EndIf}
!macroend

; Wait until `$INSTDIR\resources\node.exe` accepts a write.
;
; Windows releases an executable image a moment after the process ends, and a
; failed write is not retried by NSIS. The probe is the same request `File`
; makes - GENERIC_WRITE, share mode 0 - so its answer is exactly "would the
; copy succeed?". `FileOpen` cannot be used here: it opens with a share mode
; that a mapped image still tolerates and reports success on a running exe.
;
; Leaves 1 in $2 when the file became writable, 0 when it timed out.
!macro BozWaitForFileFree
  StrCpy $1 0
  StrCpy $2 0
  ${Do}
    System::Call 'kernel32::CreateFileW(w "$INSTDIR\resources\node.exe", i 0x40000000, i 0, p 0, i 3, i 0, p 0) l.r3'
    ${If} $3 <> -1
      System::Call 'kernel32::CloseHandle(l $3)'
      StrCpy $2 1
      ${Break}
    ${EndIf}
    Sleep 250
    IntOp $1 $1 + 1
  ${LoopWhile} $1 < 20
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro BozCloseApp

  ${If} ${FileExists} "$INSTDIR\resources\node.exe"
    !insertmacro BozWaitForFileFree
    ${If} $2 = 0
      ; Never leave the generic "Error opening file for writing" dialog: say
      ; what is holding the file and what to do about it.
      MessageBox MB_ICONSTOP|MB_OK "BOZ could not be updated because $INSTDIR\resources\node.exe is still in use.$\r$\n$\r$\nClose BOZ - including the tray icon - and run this installer again."
      Abort
    ${EndIf}
  ${EndIf}

  DetailPrint "BOZ files are ready to be replaced."
!macroend

; The uninstaller deletes the same files and leaves the same stale sidecar
; behind, so close it there too. Unlike the installer it does not abort: a
; sidecar that refuses to die is reported and the remaining files still go.
!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro BozCloseApp

  ${If} ${FileExists} "$INSTDIR\resources\node.exe"
    !insertmacro BozWaitForFileFree
    ${If} $2 = 0
      DetailPrint "The ${PRODUCTNAME} Node.js sidecar is still running; some files may be left behind."
    ${EndIf}
  ${EndIf}
!macroend
