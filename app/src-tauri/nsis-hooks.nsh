; Custom NSIS installer hooks for Efinity FaceCam.
;
; Populates the Add/Remove Programs (uninstall) registry metadata that some
; uninstaller views show as the Company / Website / Comment columns. Tauri's
; default NSIS template writes Publisher + URLInfoAbout, but not Comments, so we
; set them all here explicitly to be safe. SHCTX/UNINSTKEY are defined by the
; Tauri template (HKLM for the perMachine install mode).

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "${UNINSTKEY}" "Publisher" "THEMIS"
  WriteRegStr SHCTX "${UNINSTKEY}" "URLInfoAbout" "https://ecube.gg/"
  WriteRegStr SHCTX "${UNINSTKEY}" "HelpLink" "https://ecube.gg/"
  WriteRegStr SHCTX "${UNINSTKEY}" "Comments" "Ensure Event Excellence"
!macroend
