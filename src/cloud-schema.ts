import type { Chart } from './chart';
import { parseChart } from './chart-data';
import type { Song } from './songs';

export interface CloudConfig { apiKey: string; authDomain: string; projectId: string; appId: string }
export interface CloudChart { chart: Chart; json: string; revision: number }
export const CLOUD_JSON_LIMIT = 800_000;

export function parseCloudConfig(value: unknown): CloudConfig | null {
  if (value == null || value === '') return null;
  const item = typeof value === 'string' ? JSON.parse(value) : value;
  if (!item || typeof item !== 'object') throw new Error('FirebaseのWebアプリ設定を確認してください。');
  const { apiKey, authDomain, projectId, appId } = item as Record<string, unknown>;
  if (typeof apiKey !== 'string' || !apiKey || typeof authDomain !== 'string' || !/^[a-z0-9.-]+$/i.test(authDomain) ||
    typeof projectId !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) || typeof appId !== 'string' || !appId) {
    throw new Error('Firebase設定のapiKey・authDomain・projectId・appIdを確認してください。');
  }
  return { apiKey, authDomain, projectId, appId };
}
export function chartJson(chart: Chart, song: Song, requireNotes = false): string {
  const json = JSON.stringify(parseChart(JSON.stringify(chart), requireNotes, song));
  if (new TextEncoder().encode(json).byteLength > CLOUD_JSON_LIMIT) throw new Error('オンライン保存する譜面は800KB以内にしてください。');
  return json;
}
export function parseCloudChart(value: unknown, song: Song, published = false): CloudChart {
  const data = value as Record<string, unknown> | null;
  if (!data || data.schemaVersion !== 1 || data.songId !== song.id || data.videoId !== song.videoId ||
    typeof data.json !== 'string' || !Number.isSafeInteger(data.revision) || (data.revision as number) < 1 ||
    new TextEncoder().encode(data.json).byteLength > CLOUD_JSON_LIMIT) throw new Error('保存された譜面の形式を確認できません。');
  const chart = parseChart(data.json, published, song);
  if (data.noteCount !== chart.notes.length) throw new Error('保存されたノーツ数が一致しません。');
  return { chart, json: data.json, revision: data.revision as number };
}
