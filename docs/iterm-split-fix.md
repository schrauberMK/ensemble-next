# iTerm split pane — intermittente fix (2026-05-03)

## Symptoom
`collab-launch` meldt "iTerm launch failed" met:
```
open-iterm-monitor.sh: line 130: unexpected EOF while looking for matching `'`
```
Valt terug op tmux-sessie. Lijkt willekeurig maar is reproduceerbaar.

## Oorzaak
macOS ship't `bash 3.2.57` (GPLv2-licentie; Apple houdt 3.2 voor altijd).  
Bash 3.2 heeft een parseer-bug: **heredoc inside `$()` inside `case...esac`** werkt niet.

In `open-iterm-monitor.sh` stond de `split)` branch als:
```bash
case "$MODE" in
  split)
    if RESULT=$(osascript 2>>"$LOG" <<OSA   # ← heredoc INSIDE $() INSIDE case
    ...AppleScript...
OSA
    ); then
```
`bash -n` faalt hierop altijd. De `tab)` en `window)` branches gebruiken ook `<<OSA` maar NIET inside `$()`, dus die werken wel.

## Fix
Heredoc buiten `$()` verplaatst door eerst naar een tempbestand te schrijven:
```bash
_SCPT=$(mktemp /tmp/osa-split-XXXXXX.applescript)
cat > "$_SCPT" <<OSA          # ← heredoc NIET inside $()
...AppleScript...
OSA
if RESULT=$(osascript "$_SCPT" 2>>"$LOG"); then   # $() zonder heredoc
  rm -f "$_SCPT"
```
`bash -n` slaagt nu. Variabele-expansie (`${SOURCE_SESSION_ID}`, `${CMD}`) werkt nog steeds omdat `cat > file <<OSA` ook expandeert vóór schrijven.

## Bestand gewijzigd
`scripts/open-iterm-monitor.sh` — alleen `split)` branch (regels ~36-96)

## Wat NIET gewijzigd hoeft
- `tab)` branch: `osascript <<OSA` zonder `$()` → geen probleem
- `window)` branch: zelfde, geen `$()`
- Geen Homebrew bash 5.x nodig — fix werkt op systeem bash 3.2

## Test
```bash
bash -n scripts/open-iterm-monitor.sh  # moet "geen output" geven (= OK)
collab-launch . "test taak"            # moet iTerm split openen zonder fallback
```
