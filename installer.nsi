; Kew for Windows — installer. Cybergah Group · cybergah.com
Unicode true
Name "Kew"
OutFile "release\Kew-Setup-1.0.0.exe"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\Kew"
InstallDirRegKey HKCU "Software\Kew" "InstallDir"
Icon "resources\icon.ico"
UninstallIcon "resources\icon.ico"
BrandingText "Cybergah Group - cybergah.com"
SetCompressor /SOLID lzma

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

!define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\Kew"
!define ICO "$INSTDIR\resources\app\resources\icon.ico"

Section "Kew"
  SetOutPath "$INSTDIR"
  File /r "release\Kew-win\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\Kew"
  CreateShortCut "$SMPROGRAMS\Kew\Kew.lnk" "$INSTDIR\Kew.exe" "" "${ICO}"
  CreateShortCut "$SMPROGRAMS\Kew\Kew Kaldir.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortCut "$DESKTOP\Kew.lnk" "$INSTDIR\Kew.exe" "" "${ICO}"

  WriteRegStr HKCU "Software\Kew" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST}" "DisplayName" "Kew"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "1.0.0"
  WriteRegStr HKCU "${UNINST}" "Publisher" "Cybergah Group"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" "${ICO}"
  WriteRegStr HKCU "${UNINST}" "URLInfoAbout" "https://cybergah.com"
  WriteRegStr HKCU "${UNINST}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKCU "${UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\Kew.lnk"
  RMDir /r "$SMPROGRAMS\Kew"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Kew"
  DeleteRegKey HKCU "${UNINST}"
SectionEnd
