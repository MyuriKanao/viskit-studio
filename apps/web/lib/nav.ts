import {
  ChartLine,
  Database,
  FolderOpen,
  Image,
  LayoutDashboard,
  ListTodo,
  type LucideIcon,
  PencilLine,
  Settings,
  Sparkles,
} from 'lucide-react';

export interface NavItem {
  id: string;
  labelKey: string;
  href: string;
  icon: LucideIcon;
  enabled: boolean;
  comingInEpic?: number;
}

/**
 * Single source of truth for sidebar navigation. EPIC-6 enables only
 * Dashboard; the other 8 items render as `aria-disabled` with a tooltip
 * pointing at the EPIC that will land them.
 */
export const SIDEBAR_NAV_ITEMS: readonly NavItem[] = [
  {
    id: 'dashboard',
    labelKey: 'sidebar.dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    enabled: true,
  },
  {
    id: 'catalog',
    labelKey: 'sidebar.catalog',
    href: '/catalog',
    icon: FolderOpen,
    enabled: false,
    comingInEpic: 8,
  },
  {
    id: 'newKit',
    labelKey: 'sidebar.newKit',
    href: '/new-kit',
    icon: Sparkles,
    enabled: false,
    comingInEpic: 8,
  },
  {
    id: 'vault',
    labelKey: 'sidebar.vault',
    href: '/vault',
    icon: Database,
    enabled: false,
    comingInEpic: 8,
  },
  {
    id: 'templates',
    labelKey: 'sidebar.templates',
    href: '/templates',
    icon: Image,
    enabled: false,
    comingInEpic: 8,
  },
  {
    id: 'queue',
    labelKey: 'sidebar.queue',
    href: '/queue',
    icon: ListTodo,
    enabled: false,
    comingInEpic: 8,
  },
  {
    id: 'editor',
    labelKey: 'sidebar.editor',
    href: '/editor',
    icon: PencilLine,
    enabled: true,
  },
  {
    id: 'providers',
    labelKey: 'sidebar.providers',
    href: '/providers',
    icon: ChartLine,
    enabled: true,
  },
  {
    id: 'settings',
    labelKey: 'sidebar.settings',
    href: '/settings',
    icon: Settings,
    enabled: false,
    comingInEpic: 8,
  },
];
