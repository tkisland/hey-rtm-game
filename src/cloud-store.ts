import { doc, getDocFromServer, runTransaction, serverTimestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { Chart } from './chart';
import type { Song } from './songs';
import { cloudClient } from './cloud-auth';
import { chartJson, parseCloudChart } from './cloud-schema';
import type { CloudChart } from './cloud-schema';

const conflict = () => new Error('別の編集が保存されています。変更をJSONで書き出してから、最新の下書きを開き直してください。');
async function session(user: User) {
  const client = await cloudClient();
  if (client.auth.currentUser?.uid !== user.uid) throw new Error('ログイン状態が変わりました。管理画面を開き直してください。');
  return client;
}
export async function readDraft(song: Song, user: User): Promise<CloudChart | null> {
  const { db } = await session(user), snapshot = await getDocFromServer(doc(db, 'draftCharts', song.id));
  return snapshot.exists() ? parseCloudChart(snapshot.data(), song) : null;
}
export async function saveDraft(song: Song, user: User, chart: Chart, expectedRevision: number): Promise<CloudChart> {
  const { db } = await session(user), json = chartJson(chart, song), normalized = JSON.parse(json) as Chart;
  const revision = await runTransaction(db, async transaction => {
    const ref = doc(db, 'draftCharts', song.id), previous = await transaction.get(ref);
    const current = previous.exists() ? parseCloudChart(previous.data(), song).revision : 0;
    if (current !== expectedRevision) throw conflict();
    const revision = current + 1;
    transaction.set(ref, {schemaVersion:1, songId:song.id, videoId:song.videoId, json, noteCount:normalized.notes.length, revision, updatedAt:serverTimestamp(), updatedBy:user.uid});
    return revision;
  });
  return {chart:normalized, json, revision};
}
export async function publishDraft(song: Song, user: User, saved: CloudChart): Promise<number> {
  const { db } = await session(user), json = chartJson(saved.chart, song, true);
  return runTransaction(db, async transaction => {
    const draftRef = doc(db, 'draftCharts', song.id), publishedRef = doc(db, 'publishedCharts', song.id);
    const draft = await transaction.get(draftRef), previous = await transaction.get(publishedRef);
    if (!draft.exists() || draft.data().revision !== saved.revision || draft.data().json !== json) throw conflict();
    const revision = (previous.exists() ? parseCloudChart(previous.data(), song, true).revision : 0) + 1;
    transaction.set(publishedRef, {schemaVersion:1, songId:song.id, videoId:song.videoId, json, noteCount:saved.chart.notes.length, revision, draftRevision:saved.revision, updatedAt:serverTimestamp(), updatedBy:user.uid});
    return revision;
  });
}
