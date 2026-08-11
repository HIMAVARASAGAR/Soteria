export function isBuddyEnabled(): boolean {
  return false
}

// ── Kept for type compat only ────────────────────────────────────────────────
// Removed from runtime above so the buddy companion (axolotl/Vectordot ASCII)
// never renders. Add `|| process.env.SAGE_ENABLE_BUDDY === '1'` to both
// functions if you want to re-enable the buddy system (companion Intro, sprite
// reactions, etc).
