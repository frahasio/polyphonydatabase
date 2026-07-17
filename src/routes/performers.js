import { createEntityRouter } from './entityRouter.js';

export default createEntityRouter({
  table: 'performers',
  listKey: 'performers',
  singularKey: 'performer',
  label: 'Performer',
  fields: ['name'],
  audit: true,
  listCount: { table: 'recordings', column: 'performer_id', as: 'recording_count' },
  mergeRefs: [{ table: 'recordings', column: 'performer_id' }],
});
