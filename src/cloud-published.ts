import type { Song } from './songs';
import { cloudConfig, cloudEmulators } from './cloud-config';
import { parseCloudChart } from './cloud-schema';
import type { CloudChart } from './cloud-schema';

/** Public readers never initialize Auth or receive draft/administrator documents. */
export async function publishedChart(song: Song): Promise<CloudChart | null> {
  if (!cloudConfig) return null;
  const origin = cloudEmulators ? 'http://127.0.0.1:8080' : 'https://firestore.googleapis.com';
  const url = `${origin}/v1/projects/${encodeURIComponent(cloudConfig.projectId)}/databases/(default)/documents/publishedCharts/${encodeURIComponent(song.id)}?key=${encodeURIComponent(cloudConfig.apiKey)}`;
  const response = await fetch(url, {cache:'no-store', signal:AbortSignal.timeout(8000)});
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('公開譜面を取得できませんでした。再読み込みしてください。');
  const document = await response.json() as { fields?: Record<string, {stringValue?:string; integerValue?:string}> };
  const fields = document.fields ?? {};
  const value = Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.integerValue !== undefined ? Number(field.integerValue) : field.stringValue]));
  return parseCloudChart(value, song, true);
}
