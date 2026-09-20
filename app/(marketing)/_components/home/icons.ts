// =============================================================================
// The landing page's icon map.
//
// lib/marketing/home.ts names its icons as STRINGS so it stays a plain data
// module with no React import — content and rendering kept apart. This is the
// one place those strings become components.
//
// AN EXPLICIT MAP RATHER THAN A DYNAMIC LOOKUP. `(Lucide as never)[name]` would
// work and would also pull the entire icon set into the bundle, and a typo in a
// content file would render nothing at all rather than failing the build. With
// this map, an unknown name is a TypeScript error.
//
// LINE ICONS ONLY, at a consistent 1.6 stroke. The brief asks for minimal and
// professional rather than "generic giant colorful icons", and mixing stroke
// weights across a card grid is the fastest way to make one look homemade.
// =============================================================================
import {
  Activity,
  Briefcase,
  CalendarCheck,
  CalendarDays,
  Clock,
  ClipboardCheck,
  Database,
  FileSearch,
  FileText,
  Gauge,
  KeyRound,
  MessagesSquare,
  NotebookPen,
  PhoneCall,
  ScanSearch,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Target,
  UserCheck,
  UserPlus,
  Users,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";

export const ICONS: Record<string, LucideIcon> = {
  Activity,
  Briefcase,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  Clock,
  Database,
  FileSearch,
  FileText,
  Gauge,
  KeyRound,
  MessagesSquare,
  NotebookPen,
  PhoneCall,
  ScanSearch,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Target,
  UserCheck,
  UserPlus,
  Users,
  Workflow,
  Zap,
};

/**
 * The icon for a content entry.
 *
 * Falls back to a real icon rather than to null: a card with a hole where its
 * icon should be looks like a loading failure, and a grid that silently loses
 * one glyph is harder to notice in review than one that shows the wrong glyph.
 */
export function iconFor(name: string): LucideIcon {
  return ICONS[name] ?? Workflow;
}
