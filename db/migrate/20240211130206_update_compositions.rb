class UpdateCompositions < ActiveRecord::Migration[7.1]
  def change
    change_table :compositions, bulk: true do |t|
      t.integer :composer_id_list, array: true
    end

    reversible do |dir|
      dir.up do
        connection.execute(<<~SQL)
          UPDATE compositions
          SET composer_id_list = aggs.composer_ids
          FROM (
            SELECT
              composition_id,
              SORT(ARRAY_AGG(composer_id)) AS composer_ids
            FROM composers_compositions
            WHERE composer_id != #{Composer.anon.id}
            GROUP BY composition_id
          ) AS aggs
          WHERE compositions.id = aggs.composition_id
        SQL
      end
    end

    add_index :compositions, :number_of_voices
    add_index :compositions, :composer_id_list, using: :gin
    add_index :compositions, %i[
      composer_id_list
      composition_type_id
      even_odd
      number_of_voices
      title_id
      tone
    ], unique: true, name: "index_compositions_on_unique_fields"
  end
end
