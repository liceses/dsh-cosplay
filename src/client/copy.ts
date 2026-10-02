/**
 * dsh-cosplay — 界面文案（集中一处，避免同一个词在不同地方写法不一致）。
 *
 * M1 只有中文；英文留 M2（届时在这里按 locale 分表即可，组件不动）。
 */

/** 页签标签（也是 `conversation.view` 条目的 label）。 */
export const VIEW_LABEL = '角色'

/** 设置页标题。 */
export const SETTINGS_LABEL = '角色扮演'

/** 常用按钮/状态文案。 */
export const COPY = {
  newCard: '新建角色卡',
  importPack: '导入卡包',
  exportAll: '导出全部',
  exportToDisk: '导出到磁盘',
  refresh: '刷新',
  inUse: '使用中',
  use: '在本会话使用',
  disable: '本会话停用',
  edit: '编辑',
  copyToCustom: '复制为自定义',
  remove: '删除',
  save: '保存',
  cancel: '取消',
  back: '返回列表',
  preview: '看大图',
  uploadArt: '上传立绘',
  clearArt: '移除立绘',
  presetReadonly: '预设卡只读',
  boundTo: '本会话角色',
  none: '（没有角色）',
  manualRewrite: '试改写一次',
} as const
