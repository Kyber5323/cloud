import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { SpaceListItem } from '@/api/generated.schemas'
import { normalizeSpaceRole, useUpdateSpace } from '@/features/spaces/api'
import { useCurrentSpace } from '@/features/spaces/current-space'

/**
 * Workspace settings: edit the space name (slug stays immutable) with the
 * optimistic version guard. Only tenant administrators may rename it.
 */
export function GeneralSettingsPage() {
  const slug = useOutletContext<string>()
  const { tenantId, space } = useCurrentSpace()
  const cloudSpace = space?.slug === slug ? space : undefined
  if (!cloudSpace) return null
  return <CloudSettings tenantId={tenantId ?? ''} space={cloudSpace} />
}

/** Editable cloud workspace card for tenant administrators. */
function CloudSettings({ tenantId, space }: { tenantId: string; space: SpaceListItem }) {
  const updateSpace = useUpdateSpace(tenantId, space.id)
  const [name, setName] = useState('')
  const isAdmin = normalizeSpaceRole(space.role) === 'admin'

  return (
    <div className="max-w-lg space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">工作区</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="workspace-name">工作区名称</Label>
            <Input
              id="workspace-name"
              key={space.id}
              defaultValue={space.name}
              onChange={(e) => setName(e.target.value)}
              disabled={!isAdmin}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="workspace-slug">工作区标识（Slug）</Label>
            <Input
              id="workspace-slug"
              defaultValue={space.slug}
              key={`${space.id}-slug`}
              disabled
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="workspace-description">描述</Label>
            <Input id="workspace-description" defaultValue={space.description} disabled />
          </div>
          <Button
            onClick={() =>
              updateSpace.mutate({ name, description: space.description, version: space.version })
            }
            disabled={
              !isAdmin || updateSpace.isPending || name.trim() === '' || name === space.name
            }
          >
            {updateSpace.isPending ? '保存中…' : '保存'}
          </Button>
          {updateSpace.isError && (
            <p className="text-xs text-destructive">保存失败：版本冲突或需要管理员角色</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
