import { doc, getDocFromServer, runTransaction, serverTimestamp } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { Chart } from './chart';
import type { Song } from './songs';
import { cloudClient } from './cloud-auth';
import { chartJson, parseCloudChart } from './cloud-schema';
import type { CloudChart } from './cloud-schema';
import {cloudChartPath,DEFAULT_DIFFICULTY} from './difficulties';
import type {Difficulty} from './difficulties';
const chartFields = (difficulty:Difficulty) => difficulty === DEFAULT_DIFFICULTY ? {schemaVersion:1} : {schemaVersion:2,difficulty};
const chartRef = (db: Firestore, collection:'draftCharts'|'publishedCharts', song:Song, difficulty:Difficulty) => {
  const [first,...rest]=cloudChartPath(collection,song.id,difficulty);
  return doc(db,first,...rest);
};

const conflict = () => new Error('別の編集が保存されています。変更をJSONで書き出してから、最新の下書きを開き直してください。');
async function session(user: User) {
  const client = await cloudClient();
  if (client.auth.currentUser?.uid !== user.uid) throw new Error('ログイン状態が変わりました。管理画面を開き直してください。');
  return client;
}
export async function readDraft(song: Song, user: User, difficulty:Difficulty = DEFAULT_DIFFICULTY): Promise<CloudChart | null> {
  const { db } = await session(user), snapshot = await getDocFromServer(chartRef(db,'draftCharts',song,difficulty));
  return snapshot.exists() ? parseCloudChart(snapshot.data(), song, false, difficulty) : null;
}
export async function saveDraft(song: Song, user: User, chart: Chart, expectedRevision: number, difficulty:Difficulty = DEFAULT_DIFFICULTY): Promise<CloudChart> {
  const { db } = await session(user), json = chartJson(chart, song), normalized = JSON.parse(json) as Chart;
  const revision = await runTransaction(db, async transaction => {
    const ref = chartRef(db,'draftCharts',song,difficulty), previous = await transaction.get(ref);
    const current = previous.exists() ? parseCloudChart(previous.data(), song, false, difficulty).revision : 0;
    if (current !== expectedRevision) throw conflict();
    const revision = current + 1;
    transaction.set(ref, {...chartFields(difficulty), songId:song.id, videoId:song.videoId, json, noteCount:normalized.notes.length, revision, updatedAt:serverTimestamp(), updatedBy:user.uid});
    return revision;
  });
  return {chart:normalized, json, revision};
}
export async function publishDraft(song: Song, user: User, saved: CloudChart, difficulty:Difficulty = DEFAULT_DIFFICULTY): Promise<number> {
  const { db } = await session(user), json = chartJson(saved.chart, song, true);
  return runTransaction(db, async transaction => {
    const draftRef = chartRef(db,'draftCharts',song,difficulty), publishedRef = chartRef(db,'publishedCharts',song,difficulty);
    const draft = await transaction.get(draftRef), previous = await transaction.get(publishedRef);
    if (!draft.exists() || draft.data().revision !== saved.revision || draft.data().json !== json) throw conflict();
    const revision = (previous.exists() ? parseCloudChart(previous.data(), song, true, difficulty).revision : 0) + 1;
    transaction.set(publishedRef, {...chartFields(difficulty), songId:song.id, videoId:song.videoId, json, noteCount:saved.chart.notes.length, revision, draftRevision:saved.revision, updatedAt:serverTimestamp(), updatedBy:user.uid});
    return revision;
  });
}
