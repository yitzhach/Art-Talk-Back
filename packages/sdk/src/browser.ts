// The SDK for pages with no build step (classic scripts): bundled to one IIFE
// that publishes window.StudioSDK. Built by build/classic.mjs (bundle:classic).
export { ApiClient, ApiError, NetworkError } from "./client";
export { Studio, applyPatch } from "./studio";
export { isId, newId } from "@studio/core/ids";
