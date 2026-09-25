/**
 * 自定义 scheme 特权的**单一提交点**。
 *
 * `protocol.registerSchemesAsPrivileged()` 是替换而不是追加：第二次调用会整张表覆盖
 * 上一次。之前 `documentProtocol` 和 `pdfjsAssetProtocol` 各调了一次，后注册的
 * `knownote-asset` 顶掉了 `knownote-doc` 的 `supportFetchAPI`，渲染进程的
 * `fetch('knownote-doc://...')` 立刻报
 * `URL scheme "knownote-doc" is not supported` —— PDF Reader 整个打不开（#135）。
 *
 * 打包 smoke 当时没发现，是因为它用主进程 `net.fetch` 检查同一个协议：`protocol.handle`
 * 在 scheme 没有特权时照样在 main 里工作，只有 renderer 的 `fetch` 会失败。所以这里
 * 也补了 renderer 侧检查。
 *
 * 协议模块只声明自己的 scheme；提交集中在 `applyPrivilegedSchemes()`，在 app ready
 * 之前调用一次。
 */

import { protocol, type CustomScheme } from 'electron'

const declaredSchemes: CustomScheme[] = []

/** 声明一个 scheme 的特权。只入队，不调用 Electron API。 */
export function declarePrivilegedScheme(scheme: CustomScheme): void {
  declaredSchemes.push(scheme)
}

/** 在 app ready 之前调用一次，把全部声明一次提交。 */
export function applyPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged(declaredSchemes)
}
