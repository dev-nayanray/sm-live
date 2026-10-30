/**
 * SM Live — design system component barrel (Prompt 13).
 *
 * Re-exports every reusable component + theme token so screens import from
 * one place:
 *
 *   import { Button, Card, Input, Avatar, Badge, Loading, EmptyState, ErrorState, SectionHeader, theme, t, spacing, radius } from "../src/components";
 *
 * Adding a new component: create the file in this folder, then add an
 * export line below. Do NOT import directly from a sibling file path
 * (e.g. `from "./Button"`) — the barrel is the contract.
 */
export { Button, type ButtonProps, type ButtonVariant } from "./Button";
export { Card, type CardProps } from "./Card";
export { Input, type InputProps } from "./Input";
export { Avatar, type AvatarProps } from "./Avatar";
export { Badge, type BadgeTone, type BadgeProps } from "./Badge";
export { Loading, type LoadingProps } from "./Loading";
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export { ErrorState, type ErrorStateProps } from "./ErrorState";
export { SectionHeader, type SectionHeaderProps } from "./SectionHeader";
export { OnlineBanner } from "./OnlineBanner";
export * from "../theme";
