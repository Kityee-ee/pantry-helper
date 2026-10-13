import type { Role } from "@/lib/types";

export type IconName = "home" | "truck" | "clipboard" | "cart" | "inbox" | "gift" | "chat" | "list";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Match this path only, not its children (for section roots like /manager). */
  exact?: boolean;
}

/** Single source of truth for navigation. Add a route here and it appears in the top nav and the mobile tab bar. */
export const NAV: Record<Role, NavItem[]> = {
  manager: [
    { href: "/manager", label: "Dashboard", icon: "home", exact: true },
    { href: "/manager/delivery", label: "Delivery", icon: "truck" },
    { href: "/manager/count", label: "Count", icon: "clipboard" },
    { href: "/manager/order", label: "Order", icon: "cart" },
    { href: "/manager/inbox", label: "Inbox", icon: "inbox" },
    { href: "/food", label: "Free food", icon: "gift" },
  ],
  employee: [
    { href: "/app", label: "Tell us", icon: "chat", exact: true },
    { href: "/app/submissions", label: "My requests", icon: "list" },
    { href: "/food", label: "Free food", icon: "gift" },
  ],
};
