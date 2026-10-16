import { mountEditor } from './editor-controller';
import { findSong } from './songs';

const song = findSong(new URLSearchParams(location.search).get('song'));
if (!__ADMIN__) location.replace('./');
else if (!song) location.replace('./?missing-song=1');
else {
  const editor = mountEditor({song});
  if (import.meta.hot) import.meta.hot.dispose(() => editor.dispose());
}
