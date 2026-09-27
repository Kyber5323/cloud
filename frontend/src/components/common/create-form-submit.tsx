import { Button } from '@/components/ui/button'

/** Shared creation feedback and submit control; each form owns its validation. */
export function CreateFormSubmit({
  pending,
  submittable,
  errorCode,
}: {
  pending: boolean
  submittable: boolean
  errorCode: string | undefined
}) {
  return (
    <>
      {errorCode && (
        <p role="alert" className="text-xs text-destructive">
          创建失败：{errorCode}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={!submittable || pending}>
        {pending ? '创建中…' : '创建'}
      </Button>
    </>
  )
}
