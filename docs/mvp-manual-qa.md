# MVP Manual QA

Last automated check: 2026-06-10

## Automated Checks

```sh
pnpm test
pnpm compile
pnpm build
```

Latest local result:

- `pnpm test`: passed, 2 files and 51 tests.
- `pnpm compile`: passed.
- `pnpm build`: passed.

## Load The Extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select `.output/chrome-mv3`.
5. Pin TabCat from the extensions menu.

## Manual Scenarios

### Multiple Tabs For One Hostname

1. Open two or more ungrouped tabs from `https://github.com`.
2. Open the TabCat popup.
3. Click Group tabs.
4. Confirm Chrome creates one `github.com` tab group.
5. Confirm the popup reports one group and the expected tab count.

### Singleton Hostnames

1. Open one ungrouped tab from `https://example.com`.
2. Click Group tabs.
3. Confirm no group is created for `example.com`.
4. Confirm the popup reports the tab as skipped.

### Sibling Subdomains

1. Open one ungrouped tab from `https://docs.google.com`.
2. Open one ungrouped tab from `https://drive.google.com`.
3. Click Group tabs.
4. Confirm no `google.com` group is created.
5. Confirm the two singleton subdomains are skipped independently.

### Mixed Tab States

1. Open two ungrouped tabs from the same hostname.
2. Add one pinned tab from that hostname.
3. Add one already grouped tab from that hostname.
4. Click Group tabs.
5. Confirm only the ungrouped, unpinned tabs are grouped.
6. Confirm pinned and already grouped tabs are unchanged.

### Undo

1. Run Group tabs on a window with at least one eligible hostname group.
2. Open the TabCat popup.
3. Click Undo.
4. Confirm TabCat-created groups are removed.
5. Confirm tabs the user moved into another group after grouping are not ungrouped.

### Keyboard Shortcut

1. Open `chrome://extensions/shortcuts`.
2. Confirm TabCat exposes Group tabs using TabCat settings.
3. Trigger the shortcut.
4. Confirm it performs the same grouping behavior as the popup button.

## Manual Follow-Up

This checklist requires a human to load `.output/chrome-mv3` in Chrome and verify visible tab-strip behavior. Automated checks do not prove Chrome's unpacked extension UI and tab strip interactions.
