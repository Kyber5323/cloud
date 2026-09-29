/**
 * Messages for the `@` form's launch-field declaration.
 *
 * They live beside the feature's main bundle rather than inside it because the group is
 * self-contained — one dialog, and the field catalogue it edits — and the main bundle is held to a
 * line budget that keeps a reader able to find a key by scanning it. `translations.ts` spreads
 * these in, so the feature still ships one bundle. The history event a save records is a history
 * key, and lives with the rest of them in `history-translations.ts`.
 *
 * The field names are the editor's own: the labels the `@` form renders are the platform's, written
 * for the Issues surface, and this is the bilingual editing surface for the same five fields.
 */
export const launchFieldTranslations = {
  'zh-CN': {
    'workflows.launchFields.title': '@ 表单字段',
    'workflows.launchFields.description':
      '工作流发布后，在 Issue 里 @ 这个工作流时需要填写的内容。保存后立即生效。',
    'workflows.launchFields.ask': '询问',
    'workflows.launchFields.required': '必填',
    'workflows.launchFields.declaredByStart': '已由开始节点声明，这一行由该变量决定。',
    'workflows.launchFields.noVersion': '尚无已发布版本，此字段暂不会出现在表单里。',
    'workflows.launchFields.repository': '仓库地址',
    'workflows.launchFields.repositoryHint': '本次运行针对的仓库，默认取自 Issue 所属项目。',
    'workflows.launchFields.branch': '分支',
    'workflows.launchFields.branchHint': '本次运行针对的分支。',
    'workflows.launchFields.version': '运行版本',
    'workflows.launchFields.versionHint': '本次运行使用的已发布版本。',
    'workflows.launchFields.prompt': '提示词',
    'workflows.launchFields.promptHint': '本次运行的提示词，默认为开始节点的提示词。',
    'workflows.launchFields.context_refs': '上下文引用',
    'workflows.launchFields.context_refsHint': '随本次运行一起携带的额外上下文引用。',
  },
  'en-US': {
    'workflows.launchFields.title': '@ form fields',
    'workflows.launchFields.description':
      'What someone fills in when they @ this workflow in an issue, once it is published. Saving takes effect immediately.',
    'workflows.launchFields.ask': 'Ask',
    'workflows.launchFields.required': 'Required',
    'workflows.launchFields.declaredByStart':
      'Declared by the Start node; that variable decides this row.',
    'workflows.launchFields.noVersion':
      'No published version yet, so this field cannot appear on the form.',
    'workflows.launchFields.repository': 'Repository',
    'workflows.launchFields.repositoryHint':
      "The repository this run works on; defaults to the issue project's.",
    'workflows.launchFields.branch': 'Branch',
    'workflows.launchFields.branchHint': 'The branch this run works on.',
    'workflows.launchFields.version': 'Run version',
    'workflows.launchFields.versionHint': 'The published version this run uses.',
    'workflows.launchFields.prompt': 'Prompt',
    'workflows.launchFields.promptHint': "The prompt for this run; defaults to the Start node's.",
    'workflows.launchFields.context_refs': 'Context references',
    'workflows.launchFields.context_refsHint': 'Extra context references carried with this run.',
  },
}
