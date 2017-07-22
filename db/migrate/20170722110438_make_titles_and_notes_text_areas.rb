class MakeTitlesAndNotesTextAreas < ActiveRecord::Migration[5.0]
  def change
    change_column :pieces, :title, :text
    change_column :sources, :title, :text
    change_column :unique_pieces, :title, :text
  end
end
