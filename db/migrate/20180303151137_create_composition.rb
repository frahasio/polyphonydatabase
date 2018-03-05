class CreateComposition < ActiveRecord::Migration[5.0]
  def change
    create_table :compositions do |t|
      t.integer :number_of_voices
      t.belongs_to :group
      t.belongs_to :title
      t.timestamps

      t.index [:number_of_voices, :title_id]
    end

    create_join_table :composers, :compositions do |t|
      t.index [:composer_id, :composition_id]
    end

    add_belongs_to :inclusions, :composition
  end
end
