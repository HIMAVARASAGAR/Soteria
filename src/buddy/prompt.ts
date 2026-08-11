// Buddy system disabled — companion_intro attachment removed.
// Kept as a no-op for import compatibility.
export function getCompanionIntroAttachment(): never[] {
  return []
}

// Retained for type-reference compatibility; unused at runtime.
export function companionIntroText(_name: string, _species: string): string {
  return ''
}
