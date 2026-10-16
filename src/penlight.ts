/** Decoration stays inside the existing full-sized touch target. */
export function decoratePenlight(pad: HTMLElement): void {
  if (pad.classList.contains('penlight-pad')) return;
  let key = pad.querySelector<HTMLElement>(':scope > strong, :scope > span');
  if (!key) {
    key = document.createElement('span'); key.textContent = pad.textContent;
    pad.textContent = ''; pad.append(key);
  }
  key.classList.add('penlight-key');
  const art = document.createElement('i'); art.className = 'penlight-art'; art.setAttribute('aria-hidden', 'true');
  pad.prepend(art); pad.classList.add('penlight-pad');
}
