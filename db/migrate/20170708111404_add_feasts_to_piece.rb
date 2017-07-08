class AddFeastsToPiece < ActiveRecord::Migration[5.0]
  def change
    add_column :pieces, :feasts, :text
  end
end
