import type { Workflow as CloudWorkflow } from '@/api/generated.schemas'
import {
  parseImportedWorkflowDocument,
  WorkflowImportError,
  type ImportedWorkflowDocument,
} from '@/features/workflows/runtime/graph-import'

/** Largest workflow file accepted for reading; larger files are rejected before parsing. */
export const MAX_WORKFLOW_IMPORT_BYTES = 5 * 1024 * 1024

/** One source line shown around a JSON syntax error. */
export interface WorkflowJsonExcerptLine {
  number: number
  text: string
}

/** Where JSON parsing stopped, when the runtime reports a character position. */
export interface WorkflowJsonErrorLocation {
  line: number
  column: number
  excerpt: readonly WorkflowJsonExcerptLine[]
}

/** The graph envelope plus the counts the import preview shows. */
export interface WorkflowTransferSummary {
  nodeCount: number
  agentCount: number
  globalVariableCount: number
}

/** Why a picked file cannot become an imported workflow. */
export type WorkflowImportFailure =
  | { reason: 'invalidJson'; location: WorkflowJsonErrorLocation | null }
  | { reason: 'invalidWorkflow'; issues: readonly string[] }
  | { reason: 'fileTooLarge' }

/** Outcome of reading one exported workflow file before anything is persisted. */
export type WorkflowImportParseResult =
  { ok: true; document: ImportedWorkflowDocument } | { ok: false; failure: WorkflowImportFailure }

/**
 * Maps a `JSON.parse` failure to a 1-based line/column and nearby lines. V8 reports a
 * character offset as "at position N"; other engines may not, so the location is optional.
 */
export function jsonErrorLocation(text: string, error: unknown): WorkflowJsonErrorLocation | null {
  const message = error instanceof Error ? error.message : ''
  const match = /position (\d+)/.exec(message)
  if (match === null) {
    return null
  }
  const offset = Math.min(Number(match[1]), text.length)
  const before = text.slice(0, offset).split('\n')
  const line = before.length
  const column = (before[before.length - 1] ?? '').length + 1
  const lines = text.split('\n')
  const first = Math.max(1, line - 1)
  const last = Math.min(lines.length, line + 1)
  const excerpt: WorkflowJsonExcerptLine[] = []
  for (let number = first; number <= last; number += 1) {
    excerpt.push({ number, text: (lines[number - 1] ?? '').replace(/\r$/, '') })
  }
  return { line, column, excerpt }
}

/**
 * Validates the envelope written by workflow export and turns it into an editor document.
 *
 * This is the strict entry point: anything the editor could not redraw is reported as an
 * issue list rather than silently dropped, so the author never edits a graph that is not the
 * one they picked.
 */
export function parseWorkflowImportFile(text: string): WorkflowImportParseResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      failure: { reason: 'invalidJson', location: jsonErrorLocation(text, error) },
    }
  }
  try {
    return { ok: true, document: parseImportedWorkflowDocument(value) }
  } catch (error) {
    if (error instanceof WorkflowImportError) {
      return { ok: false, failure: { reason: 'invalidWorkflow', issues: error.issues } }
    }
    throw error
  }
}

/** Name and size of a picked file, shown under the import dialog title. */
export interface WorkflowImportFileInfo {
  name: string
  size: number
}

/**
 * Reads and parses one picked file. A file over the size limit is refused before
 * any text is parsed, because an attacker-chosen giant file should never be read
 * into memory just to be rejected.
 */
export async function readWorkflowImportFile(
  file: File,
): Promise<{ file: WorkflowImportFileInfo; parse: WorkflowImportParseResult }> {
  const info = { name: file.name, size: file.size }
  if (file.size > MAX_WORKFLOW_IMPORT_BYTES) {
    return { file: info, parse: { ok: false, failure: { reason: 'fileTooLarge' } } }
  }
  return { file: info, parse: parseWorkflowImportFile(await file.text()) }
}

/** Counts executable content; editor annotations are not counted as nodes. */
export function summarizeWorkflowTransfer(
  document: ImportedWorkflowDocument,
): WorkflowTransferSummary {
  return {
    nodeCount: document.definition.nodes.length,
    agentCount: document.definition.nodes.filter((node) => node.data.kind === 'agent').length,
    globalVariableCount: document.definition.globalVariables?.length ?? 0,
  }
}

/** Replaces characters that are unsafe in file names on any desktop platform. */
function safeFileStem(value: string): string {
  // `\p{Cc}` is the Unicode Control category; property escapes keep control
  // characters out of the regex literal so no-control-regex stays satisfied.
  return value.replace(/[<>:"/\\|?*\p{Cc}]/gu, ' ').trim()
}

/**
 * Produces a portable export filename. A published version is embedded before the extension
 * so exporting several versions of one workflow never collides on disk.
 */
export function workflowExportFileName(name: string, version: number | null = null): string {
  const stem = safeFileStem(name)
  const base = stem === '' ? 'workflow' : stem
  return version === null ? `${base}.reactflow.json` : `${base}.v${version}.reactflow.json`
}

/**
 * Builds the exact document written by export: the workflow identity plus either its live
 * draft graph or a published snapshot's graph. Shared by the file preview and the save path.
 */
export function workflowExportDocument(
  workflow: CloudWorkflow,
  graph: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: workflow.id,
    name: workflow.name,
    description:
      typeof graph['description'] === 'string' ? graph['description'] : workflow.description,
    updatedAt: workflow.updatedAt,
    ...graph,
  }
}

/** Formats a byte count the way file sizes are shown next to import file names. */
export function formatWorkflowFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
