class CreateUniquePiece < ActiveRecord::Migration[5.0]
  def change
    create_table :unique_pieces do |t|
      t.string :title
      t.string :composers
      t.integer :minimum_voices
      t.text :feasts
      t.timestamps
    end

    remove_column :pieces, :feasts

    remove_reference :editions, :piece, index: true
    add_reference :editions, :unique_piece

    remove_reference :recordings, :piece, index: true
    add_reference :recordings, :unique_piece
  end
end
