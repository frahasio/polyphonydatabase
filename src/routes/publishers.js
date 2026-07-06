import { createEntityRouter } from './entityRouter.js';

export default createEntityRouter({
  table: 'publishers',
  listKey: 'publishers',
  singularKey: 'publisher',
  label: 'Publisher',
  fields: ['name'],
  audit: false,
});
