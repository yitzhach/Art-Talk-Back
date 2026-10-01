export const nowIso = () => new Date().toISOString();
export const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString();
