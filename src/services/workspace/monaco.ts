import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js'
import 'monaco-editor/esm/vs/editor/editor.all.js'
import 'monaco-editor/esm/vs/basic-languages/monaco.contribution.js'

/** 让 Monaco 在打包产物里找到自己的 worker */
window.MonacoEnvironment = {
  getWorker: () => new Worker(new URL('./editorWorker.ts', import.meta.url), { type: 'module' }),
}

let defined = false

/** 两套主题：删行红底、加行绿底，其余沿用编辑器默认色 */
export const ensureThemes = () => {
  if (defined) {
    return
  }
  defined = true
  monaco.editor.defineTheme('ds-light', {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'diffEditor.insertedLineBackground': '#2ea04322',
      'diffEditor.insertedTextBackground': '#2ea0433d',
      'diffEditor.removedLineBackground': '#f8514922',
      'diffEditor.removedTextBackground': '#f851493d',
      'diffEditor.diagonalFill': '#0000000a',
      'editorGutter.background': '#00000000',
    },
  })
  monaco.editor.defineTheme('ds-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'diffEditor.insertedLineBackground': '#3fb95024',
      'diffEditor.insertedTextBackground': '#3fb95040',
      'diffEditor.removedLineBackground': '#f8514929',
      'diffEditor.removedTextBackground': '#f8514945',
      'diffEditor.diagonalFill': '#ffffff0a',
      'editorGutter.background': '#00000000',
    },
  })
}

export { monaco }
