import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CreateFormSubmit } from './create-form-submit'

describe('CreateFormSubmit', () => {
  it('keeps submission disabled while pending and announces an actionable failure', () => {
    const { rerender } = render(<CreateFormSubmit pending submittable errorCode={undefined} />)
    expect(screen.getByRole('button', { name: '创建中…' })).toBeDisabled()
    rerender(<CreateFormSubmit pending={false} submittable={false} errorCode="slug_conflict" />)
    expect(screen.getByRole('alert')).toHaveTextContent('创建失败：slug_conflict')
    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled()
    rerender(<CreateFormSubmit pending={false} submittable errorCode={undefined} />)
    expect(screen.getByRole('button', { name: '创建' })).toBeEnabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
