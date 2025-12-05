!include "FileFunc.nsh"
!include "LogicLib.nsh"

!macro _DownloadAndInstallEngine
  ; Define paths
  StrCpy $0 "$APPDATA\RiskWiseEngine"
  StrCpy $1 "$0\climada_env"
  StrCpy $2 "$TEMP\RiskWiseEngine.zip"

  DetailPrint "Checking for existing RISK WISE engine..."
  IfFileExists "$1\python.exe" 0 +3
    DetailPrint "Engine already installed at $1, skipping download."
    Goto done_engine

  DetailPrint "Engine not found, downloading engine archive..."

  ; TODO: update this URL to your actual asset URL
  StrCpy $3 "https://github.com/gkalomalos/ERA-Project_RISK-WISE/releases/download/v1.0.6/RiskWiseEngine-1.0.6.zip"

  ; Download using PowerShell (available on modern Windows)
  nsExec::ExecToLog 'powershell -Command "Invoke-WebRequest -Uri ''$3'' -OutFile ''$2'' -UseBasicParsing"'
  Pop $4
  ${If} $4 != 0
    MessageBox MB_ICONSTOP "Failed to download engine archive (exit code $4). RISK WISE engine may not be installed correctly."
    Goto done_engine
  ${EndIf}

  DetailPrint "Creating engine target directory: $1"
  CreateDirectory "$0"
  CreateDirectory "$1"

  DetailPrint "Extracting engine archive to $0..."
  nsExec::ExecToLog 'powershell -Command "Expand-Archive -LiteralPath ''$2'' -DestinationPath ''$0'' -Force"'
  Pop $4
  ${If} $4 != 0
    MessageBox MB_ICONSTOP "Failed to extract engine archive (exit code $4). RISK WISE engine may not be installed correctly."
    Goto done_engine
  ${EndIf}

  DetailPrint "Cleaning up temporary archive..."
  Delete "$2"

  DetailPrint "RISK WISE engine installed to $1"

done_engine:
!macroend

; Hook into installer: run after files are installed, before final page
!macro customInstall
  !insertmacro _DownloadAndInstallEngine
!macroend
