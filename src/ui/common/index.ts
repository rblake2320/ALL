/**
 * Shared UI kit (UI-SHELL owned; UI-HUD imports from here). Styles live in src/ui/theme (import once via
 * `import '../theme'` — App.tsx already does). Icons: `import { Icon } from '../icons'`.
 */
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button';
export { IconButton, type IconButtonProps } from './IconButton';
export { Panel, type PanelProps } from './Panel';
export { Card, type CardProps } from './Card';
export { Tabs, TabPanel, tabId, panelId, nextEnabledIndex, type TabItem, type TabsProps } from './Tabs';
export { Slider, type SliderProps } from './Slider';
export { Toggle, type ToggleProps } from './Toggle';
export { Select, type SelectOption, type SelectProps } from './Select';
export { Segmented, type SegmentOption, type SegmentedProps } from './Segmented';
export { Tooltip, type TooltipProps } from './Tooltip';
export { Modal, openModalCount, focusableIn, type ModalProps } from './Modal';
export { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';
export { ProgressBar, type ProgressBarProps } from './ProgressBar';
export { NeedBar, type NeedBarProps } from './NeedBar';
export { Swatch, SwatchPicker, type SwatchProps, type SwatchPickerProps } from './Swatch';
export { TextInput, clampText, type TextInputProps } from './TextInput';
export { Badge, type BadgeProps, type BadgeTone } from './Badge';
export { Kbd } from './Kbd';
export { Spinner } from './Spinner';
export { ToastCard, toastIcon, type ToastCardProps, type ToastKind } from './ToastCard';
export { ScrollArea, type ScrollAreaProps } from './ScrollArea';
export { EmptyState } from './EmptyState';
export { Divider, Ornament, type DividerProps } from './Divider';
export { Portrait, type PortraitProps } from './Portrait';
export { SettingRow, settingIds } from './SettingRow';
export { Portal, getPortalLayer, UiErrorContext, type PortalLayer } from './Portal';
export { Truncate, type TruncateProps } from './Truncate';
export { cx } from './cx';
export * from './format';
export * from './color';
export { shallowEqual } from './equality';
export { parseCombo, matchCombo, matchAny, keyLabel, comboLabels, isEditableTarget, ariaKeyShortcuts, type KeyCombo, type KeyLike } from './hotkeys';
export { computePosition, type Placement, type RectLike, type Positioned } from './position';
export { snapToStep, valueToPercent, percentToValue, keyboardStep, normRange } from './sliderMath';
