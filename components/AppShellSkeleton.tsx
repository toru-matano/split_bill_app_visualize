'use client'
/**
 * components/AppShellSkeleton.tsx
 *
 * The visual App Shell skeleton rendered immediately while group data
 * is still being fetched and decrypted server-side.
 *
 * Design principles:
 *  - Uses the exact same layout dimensions and CSS variables as the real UI
 *    so there is zero layout shift when real content replaces the skeleton.
 *  - Skeleton blocks pulse with a CSS animation (no JS timers needed).
 *  - The navbar and action buttons render fully — only the data-driven
 *    sections (member pills, expense list) are shimmer placeholders.
 *  - Accepts optional `groupName` so the page title can be shown
 *    immediately if the group metadata loads from cache.
 */

type Props = {
  groupName?: string
}

export default function AppShellSkeleton({ groupName }: Props) {
  return (
    <>
      <style>{`
        @keyframes shimmer {
          0%   { background-position: -400px 0; }
          100% { background-position:  400px 0; }
        }
        .sk {
          background: linear-gradient(
            90deg,
            var(--surface-3) 25%,
            var(--surface-2) 50%,
            var(--surface-3) 75%
          );
          background-size: 800px 100%;
          animation: shimmer 1.4s ease-in-out infinite;
          border-radius: 6px;
        }
      `}</style>

      {/* ── Navbar skeleton ── */}
      <nav className="navbar">
        <span className="navbar-title">
          <button
            className="btn btn-ghost"
            style={{ width: 70, height: 42, fontSize: 16, borderWidth: 0, pointerEvents: 'none' }}
          >
            <img src="/icon-192.png" alt="SplitMate" style={{ width: 24, height: 'auto' }} />
          </button>
        </span>
        {/* Share / settings icons as dim placeholders */}
        <div style={{ width: 70, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="sk" style={{ width: 20, height: 20, borderRadius: '50%' }} />
        </div>
        <div style={{ width: 70, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="sk" style={{ width: 20, height: 20, borderRadius: '50%' }} />
        </div>
      </nav>

      <div className="container" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Group title ── */}
        {groupName
          ? <h1>{groupName}</h1>
          : <div className="sk" style={{ height: 26, width: '55%', maxWidth: 220 }} />
        }

        {/* ── Members section ── */}
        <div>
          <div className="sk" style={{ height: 12, width: 80, marginBottom: 12 }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {[90, 72, 104, 68].map((w, i) => (
              <div
                key={i}
                className="sk"
                style={{ height: 30, width: w, borderRadius: 999 }}
              />
            ))}
          </div>
        </div>

        {/* ── Action buttons ── */}
        <div className="row" style={{ gap: 10 }}>
          <div className="sk" style={{ flex: 1, height: 44, borderRadius: 8 }} />
          <div className="sk" style={{ flex: 1, height: 44, borderRadius: 8 }} />
        </div>

        {/* ── Ad banner placeholder ── */}
        <div className="sk" style={{ height: 56, borderRadius: 8 }} />

        {/* ── Expenses section ── */}
        <div>
          <div className="sk" style={{ height: 12, width: 100, marginBottom: 16 }} />
          <div
            className="card"
            style={{ padding: '4px 20px' }}
          >
            {[1, 2, 3, 4].map(i => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 0',
                  borderBottom: i < 4 ? '1px solid var(--border)' : 'none',
                }}
              >
                {/* Avatar */}
                <div className="sk" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
                {/* Label + meta */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div className="sk" style={{ height: 14, width: `${55 + (i % 3) * 15}%` }} />
                  <div className="sk" style={{ height: 11, width: '35%' }} />
                </div>
                {/* Amount */}
                <div className="sk" style={{ height: 15, width: 52, borderRadius: 4, flexShrink: 0 }} />
              </div>
            ))}
          </div>
        </div>

        {/* ── Encrypted footer badge ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            background: 'var(--surface-2)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
            opacity: 0.5,
          }}
        >
          <i className="fa-solid fa-lock" style={{ fontSize: 13, color: 'var(--ink-3)' }} />
          <div className="sk" style={{ height: 11, width: '70%' }} />
        </div>
      </div>
    </>
  )
}
