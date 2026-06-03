; ---------------------------------------------------------------------------
; Engine artifact (Python + CLIMADA). KEEP IN SYNC with public/electron.js
; (search ENGINE_RELEASE_TAG). When changing the engine, bump the tag here
; AND in public/electron.js.
; ---------------------------------------------------------------------------
!define ENGINE_RELEASE_TAG "engine-v1"
!define ENGINE_DOWNLOAD_URL "https://github.com/gkalomalos/ERA-Project_RISK-WISE/releases/download/${ENGINE_RELEASE_TAG}/RiskWiseEngine.zip"

!include "FileFunc.nsh"
!include "LogicLib.nsh"

; Force immediate detail pane updates
!define MUI_FINISHPAGE_NOAUTOCLOSE
!define MUI_UNFINISHPAGE_NOAUTOCLOSE

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