; ---------------------------------------------------------------------------
; Engine artifact (Python + CLIMADA). KEEP IN SYNC with public/electron.js
; (search ENGINE_RELEASE_TAG). The .sha256 sidecar contains a single line of
; lowercase hex (64 chars) that must match the downloaded zip.
; ---------------------------------------------------------------------------
!define ENGINE_RELEASE_TAG "engine-v1"
!define ENGINE_DOWNLOAD_URL "https://github.com/gkalomalos/ERA-Project_RISK-WISE/releases/download/${ENGINE_RELEASE_TAG}/RiskWiseEngine.zip"
!define ENGINE_SHA256_URL "${ENGINE_DOWNLOAD_URL}.sha256"

!include "FileFunc.nsh"
!include "LogicLib.nsh"

; Force immediate detail pane updates
!define MUI_FINISHPAGE_NOAUTOCLOSE
!define MUI_UNFINISHPAGE_NOAUTOCLOSE

; Strips whitespace/CR/LF and lowercases a hex hash string.
Function NormalizeHash
  Exch $R0
  Push $R1
  Push $R2
  StrCpy $R1 ""
  StrLen $R2 $R0
  IntOp $R2 $R2 - 1
  ${ForEach} $R3 0 $R2 + 1
    StrCpy $R4 $R0 1 $R3
    ${If} $R4 == " "
    ${OrIf} $R4 == "$\r"
    ${OrIf} $R4 == "$\n"
    ${OrIf} $R4 == "$\t"
      ; skip
    ${Else}
      ; lowercase A-F -> a-f
      ${If} $R4 == "A"
        StrCpy $R4 "a"
      ${ElseIf} $R4 == "B"
        StrCpy $R4 "b"
      ${ElseIf} $R4 == "C"
        StrCpy $R4 "c"
      ${ElseIf} $R4 == "D"
        StrCpy $R4 "d"
      ${ElseIf} $R4 == "E"
        StrCpy $R4 "e"
      ${ElseIf} $R4 == "F"
        StrCpy $R4 "f"
      ${EndIf}
      StrCpy $R1 "$R1$R4"
    ${EndIf}
  ${Next}
  StrCpy $R0 $R1
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd

!macro customInit
  SetDetailsPrint both
!macroend

!macro customHeader
  ShowInstDetails show
!macroend

!macro _DownloadAndInstallEngine
  ; $0 = engine dir, $1 = python dir, $2 = archive in TEMP
  StrCpy $0 "$LOCALAPPDATA\RiskWiseEngine"
  StrCpy $1 "$0"
  StrCpy $2 "$TEMP\RiskWiseEngine.zip"

  DetailPrint "=========================================="
  DetailPrint "RISK WISE Engine Setup"
  DetailPrint "=========================================="
  DetailPrint ""
  DetailPrint "Checking for existing engine at:"
  DetailPrint "$1"
  Sleep 500
  
  IfFileExists "$1\python.exe" 0 +5
    DetailPrint ""
    DetailPrint "✓ Engine already installed"
    DetailPrint "  Skipping download and extraction"
    Sleep 800
    Goto done_engine

  DetailPrint ""
  DetailPrint "Engine not found - beginning installation..."
  Sleep 500
  
  ; Ensure engine dir is clean
  DetailPrint ""
  DetailPrint "Preparing installation directory..."
  RMDir /r "$0"
  CreateDirectory "$0"
  Sleep 300

  ; Check for cached archive
  ${If} ${FileExists} "$2"
    DetailPrint ""
    DetailPrint "✓ Found cached engine archive"
    DetailPrint "  Skipping download"
    Sleep 500
  ${Else}
    DetailPrint ""
    DetailPrint "Downloading RISK WISE engine..."
    DetailPrint "  This may take several minutes depending on your connection"
    DetailPrint "  Archive size: ~500 MB"
    Sleep 800
    
    StrCpy $3 "${ENGINE_DOWNLOAD_URL}"
    
    nsExec::ExecToLog 'curl -L "$3" --output "$2"'
    Pop $4

    ${If} $4 != 0
      DetailPrint ""
      DetailPrint "✗ Download failed (exit code: $4)"
      DetailPrint ""
      MessageBox MB_ICONSTOP|MB_TOPMOST \
        "Failed to download RISK WISE engine.$\r$\n$\r$\nExit code: $4$\r$\n$\r$\nPlease check your internet connection and try again.$\r$\n$\r$\nIf the problem persists, download the engine manually from:$\r$\n$3"
      Goto done_engine
    ${EndIf}
    
    DetailPrint ""
    DetailPrint "✓ Download complete"
    Sleep 500
  ${EndIf}

  DetailPrint ""
  DetailPrint "Verifying engine archive integrity..."
  Sleep 500

  ; Fetch expected hash sidecar -> %TEMP%\RiskWiseEngine.zip.sha256
  StrCpy $6 "$TEMP\RiskWiseEngine.zip.sha256"
  Delete "$6"
  nsExec::ExecToLog 'curl -L -f -s "${ENGINE_SHA256_URL}" --output "$6"'
  Pop $4
  ${If} $4 != 0
    DetailPrint "✗ Failed to download SHA-256 sidecar (exit code: $4)"
    MessageBox MB_ICONSTOP|MB_TOPMOST \
      "Failed to download engine integrity sidecar (${ENGINE_SHA256_URL}).$\r$\nExit code: $4$\r$\nCheck internet connection and retry."
    Goto done_engine
  ${EndIf}

  ; Compute actual hash with certutil (built into Windows since Win7)
  nsExec::ExecToStack 'cmd /c "certutil -hashfile $\"$2$\" SHA256 | findstr /v $\":$\" | findstr /v hash"'
  Pop $4
  Pop $5
  ${If} $4 != 0
    DetailPrint "✗ certutil failed (exit code: $4)"
    MessageBox MB_ICONSTOP|MB_TOPMOST "Failed to compute archive checksum. certutil exit: $4"
    Goto done_engine
  ${EndIf}

  ; $5 = computed hash (uppercase, may contain whitespace). Read expected from sidecar into $7.
  FileOpen $8 "$6" r
  FileRead $8 $7
  FileClose $8

  ; Normalize: strip CR/LF/spaces, lowercase both.
  Push $5
  Call NormalizeHash
  Pop $5
  Push $7
  Call NormalizeHash
  Pop $7

  ${If} $5 != $7
    DetailPrint "✗ Engine archive SHA-256 mismatch"
    DetailPrint "  expected: $7"
    DetailPrint "  actual:   $5"
    Delete "$2"
    Delete "$6"
    MessageBox MB_ICONSTOP|MB_TOPMOST \
      "Engine archive failed integrity check (SHA-256 mismatch).$\r$\n$\r$\nThe download may be corrupted or tampered.$\r$\nPlease run the installer again."
    Goto done_engine
  ${EndIf}

  DetailPrint "✓ Engine archive integrity verified"
  Delete "$6"
  Sleep 500

  ; Verify archive exists
  ${IfNot} ${FileExists} "$2"
    DetailPrint ""
    DetailPrint "✗ Archive verification failed"
    MessageBox MB_ICONSTOP|MB_TOPMOST \
      "Engine archive is missing after download.$\r$\n$\r$\nExpected location: $2$\r$\n$\r$\nPlease try running the installer again."
    Goto done_engine
  ${EndIf}

  DetailPrint ""
  DetailPrint "Extracting engine files..."
  DetailPrint "  This will take 1-2 minutes"
  Sleep 500
  
  ; Extract with tar
  nsExec::ExecToStack 'tar -xf "$2" -C "$0"'
  Pop $4
  Pop $5

  ${If} $4 != 0
    DetailPrint ""
    DetailPrint "✗ Extraction failed (exit code: $4)"
    DetailPrint "  Output: $5"
    MessageBox MB_ICONSTOP|MB_TOPMOST \
      "Failed to extract engine archive.$\r$\n$\r$\nExit code: $4$\r$\nSource: $2$\r$\nDestination: $0$\r$\n$\r$\nOutput: $5$\r$\n$\r$\nPlease ensure you have sufficient disk space and permissions."
    Goto done_engine
  ${EndIf}

  DetailPrint ""
  DetailPrint "✓ Extraction complete"
  Sleep 500
  
  DetailPrint ""
  DetailPrint "Cleaning up temporary files..."
  Delete "$2"
  Sleep 300

  ; Final verification
  DetailPrint ""
  DetailPrint "Verifying installation..."
  Sleep 500
  
  IfFileExists "$1\python.exe" 0 +6
    DetailPrint ""
    DetailPrint "✓ RISK WISE engine installed successfully"
    DetailPrint "  Location: $1"
    DetailPrint ""
    Sleep 800
    Goto done_engine

  DetailPrint ""
  DetailPrint "✗ Installation verification failed"
  MessageBox MB_ICONSTOP|MB_TOPMOST \
    "Engine archive was extracted, but python.exe was not found.$\r$\n$\r$\nExpected location: $1\python.exe$\r$\n$\r$\nThe installation may be corrupted. Please try again."

done_engine:
  DetailPrint "=========================================="
  DetailPrint ""
  Sleep 500
!macroend

!macro customInstall
  DetailPrint "=========================================="
  DetailPrint "Installing RISK WISE Application"
  DetailPrint "=========================================="
  DetailPrint ""
  Sleep 500
  
  !insertmacro _DownloadAndInstallEngine
  
  DetailPrint "Installing application files..."
  Sleep 500
  DetailPrint "✓ Application files installed"
  DetailPrint ""
  Sleep 300
  
  DetailPrint "Finalizing installation..."
  Sleep 500
  DetailPrint "✓ Installation complete"
  DetailPrint ""
  DetailPrint "=========================================="
  Sleep 500
!macroend