/* Where studio-api lives. Empty = solo mode: no sign-in chip, nothing syncs.
   The deploy writes the real address here (staging first). */
window.StudioConfig = window.StudioConfig || { apiUrl: '' };
