import { useState } from 'react'
import { DialogFormField } from '@/components/common/dialog-form-field'
import { CreateFormSubmit } from '@/components/common/create-form-submit'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCreateTenant } from '@/features/spaces/api'
import { isValidSlug } from '@/features/spaces/slug'

/**
 * Form fields for creating a collaboration space. The slug is normalized to
 * lowercase as the user types; the backend enforces the same rule.
 */
function CreateSpaceFields({
  onSubmit,
  pending,
  errorCode,
}: {
  onSubmit: (input: { name: string; slug: string }) => void
  pending: boolean
  errorCode: string | undefined
}) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const slugValid = slug === '' || isValidSlug(slug)
  const submittable = name.trim() !== '' && slugValid && !pending

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!submittable) return
        onSubmit({ name: name.trim(), slug })
      }}
      className="space-y-4"
    >
      <DialogFormField
        id="new-space-name"
        label="名称"
        value={name}
        onChange={setName}
        placeholder="Cloud Development"
        required
      />
      <DialogFormField
        id="new-space-slug"
        label="标识（Slug，创建后不可修改）"
        value={slug}
        onChange={(value) => setSlug(value.toLowerCase())}
        placeholder="cloud-dev"
        hint={slugValid ? undefined : '小写字母、数字与连字符，以字母或数字开头'}
        required
      />
      <CreateFormSubmit pending={pending} submittable={submittable} errorCode={errorCode} />
    </form>
  )
}

/**
 * Dialog for creating a collaboration space. The dialog content unmounts on
 * close, so fields always start fresh; on success it reports the created
 * space's slug so the caller can navigate to it.
 */
export function CreateSpaceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (slug: string) => void
}) {
  const createSpace = useCreateTenant()
  const errorCode = createSpace.error?.response?.data?.code

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>新建协作空间</DialogTitle>
          <DialogDescription>创建后你成为这个空间的管理员。</DialogDescription>
        </DialogHeader>
        <CreateSpaceFields
          pending={createSpace.isPending}
          errorCode={errorCode}
          onSubmit={(input) =>
            createSpace.mutate(input, {
              onSuccess: (created) => {
                onOpenChange(false)
                onCreated(created.space.slug)
              },
            })
          }
        />
      </DialogContent>
    </Dialog>
  )
}
