; Installer hooks for the NSIS bundle (wired up in tauri.conf.json → bundle.windows.nsis.installerHooks).

; Explorer caches the taskbar / Start menu icon of an exe by its path. An upgrade
; replaces gitstudio.exe at the same path, so without this the old icon keeps
; showing until the user signs out or the cache is rebuilt. SHUpdateImage drops
; the cached entry so the shell reloads the icon from the new binary.
!macro NSIS_HOOK_POSTINSTALL
  System::Call 'shell32::Shell_GetCachedImageIndexW(w "$INSTDIR\${MAINBINARYNAME}.exe", i 0, i 0) i .r0'
  ${If} $0 >= 0
    System::Call 'shell32::SHUpdateImageW(w "$INSTDIR\${MAINBINARYNAME}.exe", i 0, i 0, i r0)'
  ${EndIf}
  ; SHCNE_ASSOCCHANGED + SHCNF_FLUSH: let shortcuts pick up the refreshed icon.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0x1000, p 0, p 0)'
!macroend
