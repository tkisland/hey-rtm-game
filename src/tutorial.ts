import './tutorial.css';
import { LANE_COLORS } from './colors';
import { bindInput, KEYS } from './input';

const steps = [
  { title: 'タップ', description: 'ノーツが横の判定ラインに重なったら、同じ色のボタンを1回押します。', prompt: '左端のピンクを1回タップ（PC：S）', lanes: [0] },
  { title: '同時押し', description: '線でつながったノーツは、両手の親指で2つのボタンを一緒に押します。', prompt: 'ピンクと黄色を一緒に押そう（PC：S＋L）', lanes: [0, 5] },
  { title: '長押し', description: '長い帯のノーツは、終点が判定ラインに来るまで押し続けます。', prompt: '白を1秒間押し続けよう（PC：F）', lanes: [2] },
];

export function mountTutorial(): () => void {
  const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id)! as T;
  const dialog = el<HTMLDialogElement>('tutorial'), opener = el<HTMLButtonElement>('open-tutorial');
  const title = el('tutorial-title'), description = el('tutorial-description'), prompt = el('tutorial-prompt');
  const feedback = el('tutorial-feedback'), progress = el<HTMLProgressElement>('tutorial-progress');
  const previous = el<HTMLButtonElement>('tutorial-previous'), next = el<HTMLButtonElement>('tutorial-next');
  const example = el('tutorial-example'), pads = el('tutorial-pads');
  const colors = ['ピンク', '黄緑', '白', '赤', '紫', '黄色'];
  const buttons = LANE_COLORS.map((color, lane) => {
    const track = document.createElement('span'); track.className = 'tutorial-lane'; track.style.setProperty('--lane', color);
    const note = document.createElement('i'); note.className = 'tutorial-note'; track.append(note); example.append(track);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'tutorial-pad';
    button.style.setProperty('--lane', color); button.textContent = KEYS[lane].slice(-1);
    button.setAttribute('aria-label', `${colors[lane]}のボタン（${KEYS[lane].slice(-1)}キー）`);
    pads.append(button); return button;
  });
  const listeners = new AbortController(), signal = listeners.signal;
  let step = 0, active = false, completed = false, frame = 0, started = 0, unbind = () => {};
  function stop(): void {
    active = false; cancelAnimationFrame(frame); frame = 0; unbind(); unbind = () => {};
  }
  function complete(): void {
    completed = true; cancelAnimationFrame(frame); frame = 0;
    feedback.textContent = step === 2 ? 'できました！本番では帯の終点までキープしよう。' : 'できました！';
    feedback.classList.add('success');
  }
  function hold(now: number): void {
    if (!active || completed) return;
    progress.value = Math.min(1, (now - started) / 1000);
    if (progress.value >= 1) complete();
    else frame = requestAnimationFrame(hold);
  }
  function showStep(): void {
    stop(); completed = false; progress.value = 0; progress.hidden = step !== 2;
    const current = steps[step];
    el('tutorial-step').textContent = `${step + 1} / ${steps.length}`;
    title.textContent = current.title; description.textContent = current.description; prompt.textContent = current.prompt;
    feedback.textContent = 'タイミングを気にせず、操作を試せます。'; feedback.classList.remove('success');
    previous.disabled = step === 0; next.textContent = step === 2 ? '選曲に戻る' : '次へ';
    example.classList.toggle('tutorial-hold', step === 2); example.classList.toggle('tutorial-chord', step === 1);
    [...example.children].forEach((lane, index) => { lane.querySelector<HTMLElement>('.tutorial-note')!.hidden = !current.lanes.includes(index); });
    buttons.forEach((button, lane) => button.classList.toggle('target', current.lanes.includes(lane)));
    active = true;
    unbind = bindInput(buttons, lane => {
      if (active && !completed && step === 0 && lane === 0) complete();
    }, (lanes, reason) => {
      if (!active || completed) return;
      if (step === 1 && reason !== 'cancel' && lanes.has(0) && lanes.has(5)) complete();
      if (step !== 2) return;
      if (reason === 'cancel' || !lanes.has(2)) {
        cancelAnimationFrame(frame); frame = 0; progress.value = 0;
        feedback.textContent = '白を押したまま、ゲージをいっぱいにしよう。';
      } else if (!frame) {
        started = performance.now(); feedback.textContent = 'そのままキープ！'; frame = requestAnimationFrame(hold);
      }
    }, () => !active || !dialog.open);
  }
  opener.addEventListener('click', () => {
    if (dialog.open) return;
    step = 0; dialog.showModal(); document.body.classList.add('tutorial-visible'); showStep();
  }, { signal });
  el('tutorial-close').addEventListener('click', () => dialog.close(), { signal });
  dialog.addEventListener('close', () => {
    stop(); document.body.classList.remove('tutorial-visible'); opener.focus({preventScroll:true});
  }, { signal });
  previous.addEventListener('click', () => { if (step > 0) { step--; showStep(); title.focus(); } }, { signal });
  next.addEventListener('click', () => {
    if (step === steps.length - 1) dialog.close();
    else { step++; showStep(); title.focus(); }
  }, { signal });
  return () => {
    stop(); listeners.abort(); dialog.close(); document.body.classList.remove('tutorial-visible'); example.replaceChildren(); pads.replaceChildren();
  };
}
