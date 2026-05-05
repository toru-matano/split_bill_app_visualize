export type CategoryKey = 'food' | 'transport' | 'hotel' | 'activities' | 'shopping' | 'other'

export const CATEGORIES: Record<CategoryKey, { label: string; emoji: string; color: string }> = {
  food:       { label: 'Food & Drink', emoji: '🍜', color: '#f97316' },
  transport:  { label: 'Transport',    emoji: '🚆', color: '#3b82f6' },
  hotel:      { label: 'Hotel',        emoji: '🏨', color: '#8b5cf6' },
  activities: { label: 'Activities',   emoji: '🎡', color: '#10b981' },
  shopping:   { label: 'Shopping',     emoji: '🛍️', color: '#ec4899' },
  other:      { label: 'Other',        emoji: '💳', color: '#6b7280' },
}

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as CategoryKey[]
