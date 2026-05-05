'use client'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()
  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ maxWidth: 400, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🧾</div>
        <h1 style={{ marginBottom: 8 }}>Walica</h1>
        <p style={{ marginBottom: 32 }}>Split trip expenses with friends.<br />No account needed.</p>
        <button className="btn btn-primary" onClick={() => router.push('/create')}>
          Create a group
        </button>
        <p className="text-muted mt-3">Share a link — everyone can add expenses</p>
      </div>
    </main>
  )
}
