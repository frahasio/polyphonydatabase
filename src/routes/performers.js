import { createEntityRouter } from './entityRouter.js';

export default createEntityRouter({
  table: 'performers',
  listKey: 'performers',
  singularKey: 'performer',
  label: 'Performer',
  fields: ['name'],
  audit: true,
});
