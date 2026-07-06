import { createEntityRouter } from './entityRouter.js';

export default createEntityRouter({
  table: 'editors',
  listKey: 'editors',
  singularKey: 'editor',
  label: 'Editor',
  fields: ['name', 'date_of_birth'],
  audit: true,
});
