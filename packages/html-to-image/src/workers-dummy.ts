/**
 * workerd fallback for `./workers`: no thread pool on Workers, so jobs run
 * directly on the workerd entry point instead of being pooled.
 */
export type { HtmlToImageWorker } from "./workers.js";
export type {
  HtmlToImageOptions,
  OutputFormat,
  RenderOptions,
} from "./core.js";
export { render } from "./workerd.js";
import { render as workerdRender } from "./workerd.js";
import { mermaidRenderOptions, type RenderMermaid } from "./mermaid.js";
export { MERMAID_THEMES, mermaidToHtml } from "./mermaid.js";
export type { MermaidInput, MermaidOptions, MermaidTheme, MermaidWarning } from "./mermaid.js";
export const renderMermaid: RenderMermaid = ((source, options) => workerdRender(mermaidRenderOptions(source, options))) as RenderMermaid;

export const setLimit = (_limit: number): void => {};
export const close = () => {};
export const waitAll = () => Promise.resolve();
export const waitReady = (_retryTime?: number) => Promise.resolve();
export const launchWorker = () => Promise.resolve();
