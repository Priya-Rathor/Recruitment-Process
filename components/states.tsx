// =============================================================================
// Re-export shim.
//
// 21 modules import their loading/empty/error primitives from here. The real
// implementations moved to components/ui/states.tsx during the UI quality pass
// — icons, a bold headline separate from the helper line, a proper retry
// affordance — and re-exporting means every one of those modules picked the
// improvement up without being edited.
//
// That is the point of the pass: fix once, inherit everywhere. New code should
// import from "@/components/ui/states" directly; this file exists so the
// existing imports keep working and so nobody has to do a 21-file rename to get
// the benefit.
// =============================================================================
export {
  EmptyState,
  ErrorState,
  FormError,
  Skeleton,
  SkeletonRows,
  SkeletonTiles,
} from "@/components/ui/states";
