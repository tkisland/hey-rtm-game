import { mountEditor } from './editor-controller';
import { findSong } from './songs';
import {findDifficulty} from './difficulties';

const song = findSong(new URLSearchParams(location.search).get('song'));
const difficulty=findDifficulty(new URLSearchParams(location.search).get('difficulty'));
if (!__ADMIN__) location.replace('./');
else if (!song || !difficulty) location.replace('./?missing-song=1');
else {
  const editor = mountEditor({song,difficulty});
  if (import.meta.hot) import.meta.hot.dispose(() => editor.dispose());
}
