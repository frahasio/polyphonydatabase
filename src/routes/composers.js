import { createEntityRouter } from './entityRouter.js';

export default createEntityRouter({
  table: 'composers',
  listKey: 'composers',
  singularKey: 'composer',
  label: 'Composer',
  fields: [
    'name',
    'from_year',
    'to_year',
    'from_year_annotation',
    'to_year_annotation',
    'birthplace_1',
    'birthplace_2',
    'deathplace_1',
    'deathplace_2',
    'image_url',
  ],
  audit: true,
});
