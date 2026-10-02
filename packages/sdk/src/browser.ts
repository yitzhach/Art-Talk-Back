// The SDK for pages with no build step (classic scripts): bundled to one IIFE
// that publishes window.StudioSDK. See apps/show-tracker/build/bundle-sdk.mjs.
export { ApiClient, ApiError, NetworkError } from "./client";
export { Studio, applyPatch } from "./studio";
export { isId, newId } from "@studio/core/ids";
