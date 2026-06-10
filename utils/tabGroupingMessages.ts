import type {
  ApplyGroupingResult,
  LastGroupingOperation,
  TabGroupVisibilityResult,
  UndoGroupingResult,
  UngroupAllResult,
} from './tabGrouping';

export const TAB_GROUPING_ACTION_MESSAGE = 'tabcat:grouping-action';

export const TAB_GROUPING_ACTIONS = [
  'collapseAllTabGroups',
  'expandAllTabGroups',
  'getLastGroupingOperation',
  'groupCurrentWindowTabs',
  'undoLastGroupingOperation',
  'ungroupAllTabs',
] as const;

export type TabGroupingActionName = (typeof TAB_GROUPING_ACTIONS)[number];

export interface TabGroupingActionMessage {
  action: TabGroupingActionName;
  type: typeof TAB_GROUPING_ACTION_MESSAGE;
}

export interface TabGroupingActionResultMap {
  collapseAllTabGroups: TabGroupVisibilityResult;
  expandAllTabGroups: TabGroupVisibilityResult;
  getLastGroupingOperation: LastGroupingOperation | null;
  groupCurrentWindowTabs: ApplyGroupingResult;
  undoLastGroupingOperation: UndoGroupingResult;
  ungroupAllTabs: UngroupAllResult;
}

export function isTabGroupingActionName(
  value: unknown,
): value is TabGroupingActionName {
  return (
    typeof value === 'string' &&
    (TAB_GROUPING_ACTIONS as readonly string[]).includes(value)
  );
}

