import { createEntityRouter } from './entityRouter.js';

export default createEntityRouter({
  table: 'scribes',
  listKey: 'scribes',
  singularKey: 'scribe',
  label: 'Scribe',
  fields: ['name'],
  audit: false,
});
