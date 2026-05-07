'use client'
import { use } from 'react'
import ExpenseForm from '@/components/ExpenseForm'

type PageProps = { params: Promise<{ token: string; expenseId: string }> }

export default function EditExpensePage({ params }: PageProps) {
  const { token, expenseId } = use(params)
  return <ExpenseForm mode={{ type: 'edit', token, expenseId }} />
}
