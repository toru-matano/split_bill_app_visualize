'use client'
import { use } from 'react'
import ExpenseForm from '@/components/ExpenseForm'

type PageProps = { params: Promise<{ token: string }> }

export default function AddExpensePage({ params }: PageProps) {
  const { token } = use(params)
  return <ExpenseForm mode={{ type: 'add', token }} />
}
