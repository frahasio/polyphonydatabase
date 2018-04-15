class AddOptionalToClef < ActiveRecord::Migration[5.0]
  def change
    add_column :clefs, :optional, :boolean, null: false, default: false
    remove_index :clefs, :note
    add_index :clefs, [:note, :optional], unique: true
  end
end
