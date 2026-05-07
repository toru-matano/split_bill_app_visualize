export type CategoryKey = 'general' | 'food' | 'transport' | 'hotel' | 'activities' | 'shopping' | 'other'

export const CATEGORY_EMOJI: Record<CategoryKey, string> = {
  general:    '💸',
  food:       '🍜',
  transport:  '🚆',
  hotel:      '🏨',
  activities: '🎡',
  shopping:   '🛍️',
  other:      '💳',
}

export const CATEGORY_COLOR: Record<CategoryKey, string> = {
  general:    '#6b7280',
  food:       '#f97316',
  transport:  '#3b82f6',
  hotel:      '#8b5cf6',
  activities: '#10b981',
  shopping:   '#ec4899',
  other:      '#6b7280',
}

// i18n key used in messages files: categories.<key>
export const CATEGORIES: Record<CategoryKey, { label: string; emoji: string; color: string }> = {
  general:    { label: 'General',    emoji: '💸', color: '#6b7280' },
  food:       { label: 'Food',       emoji: '🍜', color: '#f97316' },
  transport:  { label: 'Transport',  emoji: '🚆', color: '#3b82f6' },
  hotel:      { label: 'Hotel',      emoji: '🏨', color: '#8b5cf6' },
  activities: { label: 'Activities', emoji: '🎡', color: '#10b981' },
  shopping:   { label: 'Shopping',   emoji: '🛍️', color: '#ec4899' },
  other:      { label: 'Other',      emoji: '💳', color: '#6b7280' },
}

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as CategoryKey[]
