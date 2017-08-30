class Denormalise < ActiveRecord::Migration[5.0]
  def change
    add_column :inclusions, :unique_piece_id, :integer, null: true
    add_column :inclusions, :public_notes, :string
    add_column :inclusions, :position, :integer

    add_column :sources, :dates, :string
    add_column :sources, :location_and_pubscribe, :string

    rename_column :unique_pieces, :composers, :composer_list

    add_column :unique_pieces, :has_edition, :boolean, default: false
    add_column :unique_pieces, :has_recording, :boolean, default: false

    create_table :feasts_unique_pieces, force: true do |t|
      t.string :feast_code
      t.references :unique_piece
    end

    create_table :composers_unique_pieces, force: true do |t|
      t.references :composer
      t.references :unique_piece
    end
  end
end
